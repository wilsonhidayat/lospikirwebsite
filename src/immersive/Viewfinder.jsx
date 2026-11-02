/**
 * The viewfinder overlay: what you'd see through the camera's EVF while the
 * flight plays. Frame corners, autofocus box, and the real settings the
 * photograph was taken with (read from its EXIF).
 *
 * Visibility and the focus lock are driven by CSS variables the stage sets
 * every frame (--imm-hud, --imm-lock), so this component only re-renders
 * when the chapter changes.
 */
export default function Viewfinder({ exif, index, total }) {
  const v = (x) => x || '—'
  return (
    <div className="vf" aria-hidden="true">
      <span className="vf__corner vf__corner--tl" />
      <span className="vf__corner vf__corner--tr" />
      <span className="vf__corner vf__corner--bl" />
      <span className="vf__corner vf__corner--br" />

      <div className="vf__top">
        <span>AF-C</span>
        <span>RAW</span>
        <span className="vf__battery">
          <i />
        </span>
        <span className="vf__count">
          {String(index + 1).padStart(3, '0')}/{String(total).padStart(3, '0')}
        </span>
      </div>

      <div className="vf__focus">
        <span />
      </div>

      <div className="vf__bottom">
        <span className="vf__mode">M</span>
        <span>{v(exif?.shutter)}</span>
        <span>{v(exif?.aperture)}</span>
        <span className="vf__meter" aria-hidden="true">
          <i />
        </span>
        <span>ISO {v(exif?.iso)}</span>
        <span className="vf__focal">{v(exif?.focal)}</span>
      </div>
    </div>
  )
}
