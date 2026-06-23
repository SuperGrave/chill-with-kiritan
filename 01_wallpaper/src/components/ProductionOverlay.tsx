import OverlayApp from '../../../02_ui-overlay/src/App';

export default function ProductionOverlay() {
  return (
    <div className="production-overlay-layer" aria-label="Wallpaper information overlay">
      <OverlayApp productionMode />
    </div>
  );
}
