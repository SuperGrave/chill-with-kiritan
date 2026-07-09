use crate::models::StartupConfig;
use serde::Serialize;
use std::{env, io, process::Command};

const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const VALUE_NAME: &str = "Tohoku Companion";
const TASK_NAME: &str = "Tohoku Companion";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupStatus {
    pub launch_at_login: bool,
    pub launch_with_highest_privileges: bool,
    pub task_registered: bool,
    pub run_key_registered: bool,
    pub method: String,
    pub task_name: String,
    pub exe_path: String,
}

pub fn reconcile(config: &StartupConfig) -> io::Result<StartupStatus> {
    set_launch_at_login(
        config.launch_at_login,
        config.launch_with_highest_privileges,
    )?;
    Ok(status(config))
}

pub fn handle_cli_args() -> bool {
    let mut args = env::args().skip(1);
    let Some(command) = args.next() else {
        return false;
    };
    if command != "--tohoku-startup-register" {
        return false;
    }
    let highest = matches!(args.next().as_deref(), Some("highest"));
    if let Err(e) = register_scheduled_task_for_current_exe(highest) {
        eprintln!("[companion] elevated startup registration failed: {e}");
        std::process::exit(1);
    }
    true
}

#[cfg(windows)]
pub fn request_elevated_registration(config: &StartupConfig) -> io::Result<()> {
    if !config.launch_at_login {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "launchAtLogin is disabled",
        ));
    }
    let exe = env::current_exe()?;
    let run_level = if config.launch_with_highest_privileges {
        "highest"
    } else {
        "limited"
    };
    let output = Command::new("powershell")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command"])
        .arg(
            "param([string]$Exe,[string]$Action,[string]$RunLevel) \
             Start-Process -FilePath $Exe -ArgumentList @($Action,$RunLevel) -Verb RunAs -WindowStyle Hidden",
        )
        .arg(exe.display().to_string())
        .arg("--tohoku-startup-register")
        .arg(run_level)
        .output()?;
    if output.status.success() {
        return Ok(());
    }
    Err(command_error("Start-Process -Verb RunAs", &output))
}

#[cfg(not(windows))]
pub fn request_elevated_registration(_config: &StartupConfig) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "elevated startup registration is only available on Windows",
    ))
}

pub fn status(config: &StartupConfig) -> StartupStatus {
    let task_registered = scheduled_task_exists();
    let run_key_registered = run_key_exists();
    let method = match (task_registered, run_key_registered) {
        (true, true) => "taskScheduler+runKey",
        (true, false) => "taskScheduler",
        (false, true) => "runKey",
        (false, false) => "none",
    }
    .to_string();

    StartupStatus {
        launch_at_login: config.launch_at_login,
        launch_with_highest_privileges: config.launch_with_highest_privileges,
        task_registered,
        run_key_registered,
        method,
        task_name: TASK_NAME.to_string(),
        exe_path: env::current_exe()
            .map(|p| p.display().to_string())
            .unwrap_or_default(),
    }
}

#[cfg(windows)]
pub fn set_launch_at_login(enabled: bool, highest_privileges: bool) -> io::Result<()> {
    if enabled {
        let exe = env::current_exe()?;
        match create_scheduled_task(&exe.display().to_string(), highest_privileges) {
            Ok(()) => {
                // The scheduled task is the preferred startup path. Remove the
                // legacy Run-key value so the companion does not launch twice.
                let _ = delete_run_key();
                return Ok(());
            }
            Err(task_error) => {
                // Fall back to the Run key. This is less deterministic than an
                // ONLOGON task, but it is better than silently losing autostart.
                set_run_key(&exe.display().to_string()).map_err(|run_error| {
                    io::Error::new(
                        io::ErrorKind::Other,
                        format!(
                            "scheduled task registration failed: {task_error}; Run-key fallback failed: {run_error}"
                        ),
                    )
                })?;
                return Ok(());
            }
        }
    }

    let _ = delete_scheduled_task();
    let _ = delete_run_key();
    Ok(())
}

#[cfg(windows)]
fn register_scheduled_task_for_current_exe(highest_privileges: bool) -> io::Result<()> {
    let exe = env::current_exe()?;
    create_scheduled_task(&exe.display().to_string(), highest_privileges)?;
    let _ = delete_run_key();
    Ok(())
}

#[cfg(not(windows))]
fn register_scheduled_task_for_current_exe(_highest_privileges: bool) -> io::Result<()> {
    Ok(())
}

#[cfg(not(windows))]
pub fn set_launch_at_login(_enabled: bool, _highest_privileges: bool) -> io::Result<()> {
    Ok(())
}

#[cfg(not(windows))]
fn scheduled_task_exists() -> bool {
    false
}

#[cfg(not(windows))]
fn run_key_exists() -> bool {
    false
}

#[cfg(windows)]
fn create_scheduled_task(exe_path: &str, highest_privileges: bool) -> io::Result<()> {
    let action = format!("\"{exe_path}\"");
    let run_level = if highest_privileges {
        "HIGHEST"
    } else {
        "LIMITED"
    };
    let output = Command::new("schtasks")
        .args(["/Create", "/TN", TASK_NAME, "/SC", "ONLOGON", "/TR"])
        .arg(&action)
        .args(["/RL", run_level, "/F"])
        .output()?;
    if output.status.success() {
        return Ok(());
    }
    Err(command_error("schtasks /Create", &output))
}

#[cfg(windows)]
fn delete_scheduled_task() -> io::Result<()> {
    let output = Command::new("schtasks")
        .args(["/Delete", "/TN", TASK_NAME, "/F"])
        .output()?;
    if output.status.success() || command_output_contains(&output, "cannot find") {
        return Ok(());
    }
    Err(command_error("schtasks /Delete", &output))
}

#[cfg(windows)]
fn scheduled_task_exists() -> bool {
    Command::new("schtasks")
        .args(["/Query", "/TN", TASK_NAME])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

#[cfg(windows)]
fn set_run_key(exe_path: &str) -> io::Result<()> {
    let value = format!("\"{exe_path}\"");
    let output = Command::new("reg")
        .args([
            "add", RUN_KEY, "/v", VALUE_NAME, "/t", "REG_SZ", "/d", &value, "/f",
        ])
        .output()?;
    if output.status.success() {
        return Ok(());
    }
    Err(command_error("reg add", &output))
}

#[cfg(windows)]
fn delete_run_key() -> io::Result<()> {
    let output = Command::new("reg")
        .args(["delete", RUN_KEY, "/v", VALUE_NAME, "/f"])
        .output()?;
    if output.status.success() || command_output_contains(&output, "unable to find") {
        return Ok(());
    }
    Err(command_error("reg delete", &output))
}

#[cfg(windows)]
fn run_key_exists() -> bool {
    Command::new("reg")
        .args(["query", RUN_KEY, "/v", VALUE_NAME])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

#[cfg(windows)]
fn command_error(label: &str, output: &std::process::Output) -> io::Error {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    io::Error::new(
        io::ErrorKind::Other,
        format!(
            "{label} failed with status {}; stdout: {}; stderr: {}",
            output.status,
            stdout.trim(),
            stderr.trim()
        ),
    )
}

#[cfg(windows)]
fn command_output_contains(output: &std::process::Output, needle: &str) -> bool {
    let needle = needle.to_ascii_lowercase();
    String::from_utf8_lossy(&output.stdout)
        .to_ascii_lowercase()
        .contains(&needle)
        || String::from_utf8_lossy(&output.stderr)
            .to_ascii_lowercase()
            .contains(&needle)
}
