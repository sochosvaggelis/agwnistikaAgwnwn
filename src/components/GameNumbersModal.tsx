import { useState } from 'react'
import { useI18n } from '../i18n'
import type { Game, Player, Side, Team } from '../db/types'
import { sortPlayers } from '../db/repo'
import { numberInGame } from '../db/players'
import { Modal } from './Modal'
import { TeamName } from './TeamSwatch'

/**
 * The numbers the players of a game wear in it. A different number changes only this game:
 * the player stays one, with all their stats together.
 */
export function GameNumbersModal({ game, sides, teams, players, onSave, onClose }: {
  game: Game
  sides: Side[]
  /** Home and away */
  teams: (Team | undefined)[]
  /** The players with their own numbers */
  players: Map<number, Player>
  onSave: (player: Player, number: string) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  return (
    <Modal title={t('game.numbers')} onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>{t('common.close')}</button>}>
      <p className="hint">{t('game.numbersHint')}</p>
      {sides.map(side => (
        <section key={side}>
          {sides.length > 1 && <h3><TeamName team={teams[side === 'home' ? 0 : 1]} /></h3>}
          <table className="simple-table numbers-table">
            <tbody>
              {sortPlayers(game.roster[side].map(id => players.get(id)).filter((p): p is Player => !!p)).map(p => (
                <NumberRow key={p.id} player={p} worn={numberInGame(p, game)} onSave={n => onSave(p, n)} />
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </Modal>
  )
}

function NumberRow({ player, worn, onSave }: { player: Player; worn: string; onSave: (number: string) => void }) {
  const { t } = useI18n()
  const [number, setNumber] = useState(worn)
  const changed = number.trim() !== '' && number.trim() !== player.number
  return (
    <tr>
      <td className="numbers-input">
        <input
          inputMode="numeric"
          value={number}
          placeholder={player.number}
          aria-label={t('common.number')}
          onChange={e => setNumber(e.target.value)}
          onBlur={() => number.trim() !== worn && onSave(number)}
        />
      </td>
      <td>
        {player.name || '–'}
        {changed && <span className="muted"> · {t('game.ownNumber', { n: player.number || '–' })}</span>}
      </td>
    </tr>
  )
}
