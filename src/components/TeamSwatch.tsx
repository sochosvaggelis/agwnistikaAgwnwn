import type { Team } from '../db/types'
import { swatchBackground } from '../teamColors'

/** A dot in the team's colors, split diagonally when it has two; nothing for a team without colors */
export function TeamSwatch({ team }: { team?: Pick<Team, 'colors'> }) {
  const background = swatchBackground(team)
  return background ? <span className="team-swatch" style={{ background }} aria-hidden="true" /> : null
}

/** The team's name after its swatch, as one inline piece */
export function TeamName({ team }: { team?: Pick<Team, 'colors' | 'name'> }) {
  return <span className="team-name"><TeamSwatch team={team} />{team?.name ?? ''}</span>
}
