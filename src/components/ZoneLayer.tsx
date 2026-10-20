import { useId } from 'react'
import { COURT } from '../stats/rules'
import { BASE_WING, WING_TOP, zoneHeat, type CourtZone } from '../stats/zones'

const { width: W, length: L, basketX: BX, basketY: BY, threeRadius: R3, cornerThreeX: CX, cornerThreeY: CY } = COURT
const LANE = COURT.laneHalfWidth

/** A wedge from the basket between two directions (degrees, see angleFromBasket), long enough to leave the court */
function wedge(from: number, to: number): string {
  const steps = Math.ceil((to - from) / 30)
  const points = [[BX, BY]]
  for (let i = 0; i <= steps; i++) {
    const a = ((from + ((to - from) * i) / steps) * Math.PI) / 180
    points.push([BX + 40 * Math.cos(a), BY + 40 * Math.sin(a)])
  }
  return `M${points.map(p => p.map(n => n.toFixed(3)).join(' ')).join('L')}Z`
}
const rect = (x: number, y: number, w: number, h: number) => `M${x} ${y}h${w}v${h}h${-w}Z`

const PAINT = rect(BX - LANE, 0, LANE * 2, COURT.laneLength)
const INSIDE_ARC = `M${CX} 0L${CX} ${CY}A${R3} ${R3} 0 0 0 ${W - CX} ${CY}L${W - CX} 0Z`
const MID_REGION = `${INSIDE_ARC}${PAINT}`
const THREE_REGION = `${rect(0, 0, W, L)}${INSIDE_ARC}`

/** Where each zone's shape comes from: a wedge or rectangle, cut to its region */
const SHAPES: Record<CourtZone, { d: string; region: 'paint' | 'mid' | 'corner' | 'above' }> = {
  paint: { d: PAINT, region: 'paint' },
  midBaseR: { d: wedge(-90, BASE_WING), region: 'mid' },
  midWingR: { d: wedge(BASE_WING, WING_TOP), region: 'mid' },
  midTop: { d: wedge(WING_TOP, 180 - WING_TOP), region: 'mid' },
  midWingL: { d: wedge(180 - WING_TOP, 180 - BASE_WING), region: 'mid' },
  midBaseL: { d: wedge(180 - BASE_WING, 270), region: 'mid' },
  corner3L: { d: rect(-1, -1, BX + 1, CY + 1), region: 'corner' },
  corner3R: { d: rect(BX, -1, W - BX + 1, CY + 1), region: 'corner' },
  wing3R: { d: wedge(-90, WING_TOP), region: 'above' },
  top3: { d: wedge(WING_TOP, 180 - WING_TOP), region: 'above' },
  wing3L: { d: wedge(180 - WING_TOP, 270), region: 'above' },
}

/** Label positions; the corners are too narrow for two lines, so they get one line on its side */
const LABELS: Record<CourtZone, { x: number; y: number; side?: boolean }> = {
  paint: { x: BX, y: 3.55 },
  midBaseL: { x: 2.9, y: 1.6 },
  midBaseR: { x: W - 2.9, y: 1.6 },
  midWingL: { x: 3.7, y: 5.4 },
  midWingR: { x: W - 3.7, y: 5.4 },
  midTop: { x: BX, y: 6.85 },
  corner3L: { x: CX / 2, y: CY / 2, side: true },
  corner3R: { x: W - CX / 2, y: CY / 2, side: true },
  wing3L: { x: 1.7, y: 7.6 },
  wing3R: { x: W - 1.7, y: 7.6 },
  top3: { x: BX, y: 10.7 },
}

const heatColor = (level: number) => `var(--zone-${level < 0 ? `n${-level}` : level > 0 ? `p${level}` : '0'})`

/** The court's zones colored hot or cold, each labeled with made/attempts and its percentage. */
export function ZoneLayer({ splits, shown }: { splits: Record<CourtZone, { m: number; a: number }>; shown: (z: CourtZone) => boolean }) {
  const id = useId()
  const cell = (z: CourtZone) => {
    const { m, a } = splits[z]
    const fill = shown(z) && a > 0 ? heatColor(zoneHeat(z, m, a)) : 'none'
    return <path key={z} d={SHAPES[z].d} className="zone-cell" style={{ fill }} />
  }
  const zones = (region: (typeof SHAPES)[CourtZone]['region']) =>
    (Object.keys(SHAPES) as CourtZone[]).filter(z => SHAPES[z].region === region).map(cell)

  return (
    <g>
      <defs>
        <clipPath id={`${id}mid`}><path d={MID_REGION} clipRule="evenodd" /></clipPath>
        <clipPath id={`${id}three`}><path d={THREE_REGION} clipRule="evenodd" /></clipPath>
        <clipPath id={`${id}above`}><rect x={-1} y={CY} width={W + 2} height={L} /></clipPath>
      </defs>
      {zones('paint')}
      <g clipPath={`url(#${id}mid)`}>{zones('mid')}</g>
      <g clipPath={`url(#${id}three)`}>
        {zones('corner')}
        <g clipPath={`url(#${id}above)`}>{zones('above')}</g>
      </g>
      {(Object.keys(LABELS) as CourtZone[]).filter(shown).map(z => {
        const { m, a } = splits[z]
        const { x, y, side } = LABELS[z]
        const pct = a ? `${Math.round((m / a) * 100)}%` : '–'
        if (side) {
          return (
            <text key={z} x={x} y={y} className="zone-label zone-label-side" transform={`rotate(-90 ${x} ${y})`}>
              {m}/{a} · {pct}
            </text>
          )
        }
        return (
          <text key={z} x={x} y={y} className={`zone-label${a ? '' : ' empty'}`}>
            <tspan x={x} dy="-0.15em">{m}/{a}</tspan>
            <tspan x={x} dy="1.1em" className="zone-pct">{pct}</tspan>
          </text>
        )
      })}
    </g>
  )
}
