export type Side = 'home' | 'away'

export interface Season {
  id?: number
  name: string
  createdAt: number
}

/** A season has at most one competition of each kind; the name can be edited freely */
export type CompetitionKind = 'league' | 'cup' | 'friendly' | 'other'

export interface Competition {
  id?: number
  seasonId: number
  /** Missing on competitions created before kinds existed; read it with competitionKind() */
  kind?: CompetitionKind
  name: string
  createdAt: number
}

export interface Team {
  id?: number
  name: string
  isMine: boolean
  createdAt: number
}

export interface Player {
  id?: number
  teamId: number
  name: string
  number: string
  position?: string
  active: boolean
  createdAt: number
}

export type GameStatus = 'live' | 'finished'

export interface Game {
  id?: number
  competitionId: number
  /** ISO date, yyyy-mm-dd */
  date: string
  homeTeamId: number
  awayTeamId: number
  venue?: string
  /** Player ids dressed for this game, per side */
  roster: Record<Side, number[]>
  status: GameStatus
  period: number
  clockEnabled: boolean
  periodLengthMin: number
  otLengthMin: number
  /** Remaining time in the current period when the clock was last stopped */
  clockMs: number
  /** Epoch ms when the clock was started, null while stopped */
  clockRunningSince: number | null
  /** Last used event group number */
  lastGroup: number
  createdAt: number
  updatedAt: number
}

export type ShotType = 'FG2' | 'FG3' | 'FT'

export type FoulType =
  | 'P' // personal
  | 'S' // shooting
  | 'O' // offensive
  | 'T' // technical
  | 'U' // unsportsmanlike
  | 'D' // disqualifying

export type CoachFoulType = 'C' | 'B'

export type EventType =
  | ShotType
  | 'OREB'
  | 'DREB'
  | 'AST'
  | 'STL'
  | 'BLK'
  | 'TOV'
  | 'FOUL'
  | 'COACH_FOUL'

export interface GameEvent {
  id?: number
  gameId: number
  /** Ordering within the game */
  seq: number
  /** Events entered in one action flow share a group; undo removes a whole group */
  group: number
  period: number
  /** Remaining time in the period when the event happened (clock games only) */
  clockMs?: number
  side: Side
  /** Absent for team-level events (coach/bench fouls) */
  playerId?: number
  type: EventType
  /** Shots and free throws */
  made?: boolean
  /** Shot location in meters on a FIBA half court: x 0..15 (sideline to sideline), y 0..14 (from baseline) */
  x?: number
  y?: number
  foulType?: FoulType
  coachFoulType?: CoachFoulType
  /** FOUL: the player who was fouled. BLK: the shooter whose shot was blocked. */
  targetPlayerId?: number
  createdAt: number
}

export interface Setting {
  key: string
  value: unknown
}
