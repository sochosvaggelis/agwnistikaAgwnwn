import { useId, type PointerEvent, type ReactNode } from 'react'
import { COURT } from '../stats/rules'
import type { Shot } from '../stats/compute'

const { width: W, length: L, basketX: BX, basketY: BY, threeRadius: R3, cornerThreeX: CX, cornerThreeY: CY } = COURT

const twoPointArea = `M${CX} 0 L${CX} ${CY} A${R3} ${R3} 0 0 0 ${W - CX} ${CY} L${W - CX} 0 Z`
const threePointArea = `M0 0 H${W} V${L} H0 Z ${twoPointArea}`

interface Props {
  shots?: Shot[]
  /** Called with meters on the half court when the court is tapped */
  onTap?: (x: number, y: number) => void
  /** Shade the area matching the shot being entered */
  highlight?: 'FG2' | 'FG3'
  /** Mark the spot of the play being entered */
  marker?: { x: number; y: number }
  /** Drawn on the floor, under the court lines (meters, like everything else) */
  layer?: ReactNode
  className?: string
}

export function Court({ shots = [], onTap, highlight, marker, layer, className }: Props) {
  const clipId = useId()
  function handlePointer(e: PointerEvent<SVGSVGElement>) {
    if (!onTap) return
    const svg = e.currentTarget
    const ctm = svg.getScreenCTM()
    if (!ctm) return
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse())
    onTap(Math.min(W, Math.max(0, pt.x)), Math.min(L, Math.max(0, pt.y)))
  }

  return (
    <svg
      className={`court${onTap ? ' court-tappable' : ''}${className ? ` ${className}` : ''}`}
      viewBox={`-0.3 -0.3 ${W + 0.6} ${L + 0.6}`}
      onPointerUp={handlePointer}
      role={onTap ? 'button' : 'img'}
    >
      <rect x={-0.3} y={-0.3} width={W + 0.6} height={L + 0.6} className="court-floor" />
      <rect x={BX - COURT.laneHalfWidth} y={0} width={COURT.laneHalfWidth * 2} height={COURT.laneLength} className="court-paint" />
      {highlight === 'FG2' && <path d={twoPointArea} className="court-highlight" />}
      {highlight === 'FG3' && <path d={threePointArea} fillRule="evenodd" className="court-highlight" />}
      {layer && (
        <>
          <clipPath id={clipId}><rect x={0} y={0} width={W} height={L} /></clipPath>
          <g clipPath={`url(#${clipId})`}>{layer}</g>
        </>
      )}
      <g className="court-lines">
        <rect x={0} y={0} width={W} height={L} />
        <rect x={BX - COURT.laneHalfWidth} y={0} width={COURT.laneHalfWidth * 2} height={COURT.laneLength} />
        <circle cx={BX} cy={COURT.laneLength} r={COURT.ftCircleRadius} />
        <path d={`M${CX} 0 L${CX} ${CY} A${R3} ${R3} 0 0 0 ${W - CX} ${CY} L${W - CX} 0`} />
        <path d={`M${BX - COURT.restrictedRadius} ${BY} A${COURT.restrictedRadius} ${COURT.restrictedRadius} 0 0 0 ${BX + COURT.restrictedRadius} ${BY}`} />
        <path d={`M${BX - 1.8} ${L} A1.8 1.8 0 0 1 ${BX + 1.8} ${L}`} />
        <line x1={BX - 0.9} y1={1.2} x2={BX + 0.9} y2={1.2} />
        <circle cx={BX} cy={BY} r={0.225} />
      </g>
      <g>
        {shots.map((s, i) =>
          s.made ? (
            <circle key={i} cx={s.x} cy={s.y} r={0.26} className="shot-made" />
          ) : (
            <g key={i} className="shot-missed">
              <line x1={s.x - 0.22} y1={s.y - 0.22} x2={s.x + 0.22} y2={s.y + 0.22} />
              <line x1={s.x - 0.22} y1={s.y + 0.22} x2={s.x + 0.22} y2={s.y - 0.22} />
            </g>
          ),
        )}
      </g>
      {marker && (
        <g className="court-marker">
          <circle cx={marker.x} cy={marker.y} r={0.45} />
          <circle cx={marker.x} cy={marker.y} r={0.09} className="court-marker-dot" />
        </g>
      )}
    </svg>
  )
}
