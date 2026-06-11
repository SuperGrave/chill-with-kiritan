fn main() {
    // MinGW's windres cannot handle non-ASCII (Japanese) paths.
    // Point the window icon to an ASCII-only copy so windres doesn't choke.
    tauri_build::try_build(
        tauri_build::Attributes::new().windows_attributes(
            tauri_build::WindowsAttributes::new()
                .window_icon_path("C:/cargo-build/tc-icon/icon.ico"),
        ),
    )
    .expect("failed to run tauri-build");
}
