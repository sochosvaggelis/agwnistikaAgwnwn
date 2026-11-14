import { useState, type ReactNode } from 'react'
import { useI18n } from '../i18n'
import { Modal } from './Modal'

/**
 * Choose which parts of a page go into the PDF, listed in the page's order.
 * `children` adds more choices under the parts.
 */
export function PrintDialog<P extends string>({ parts, label, initial, onPrint, onClose, children }: {
  parts: readonly P[]
  label: (part: P) => ReactNode
  initial: P[]
  onPrint: (parts: P[]) => void
  onClose: () => void
  children?: ReactNode
}) {
  const { t } = useI18n()
  const [chosen, setChosen] = useState(initial)
  const toggle = (part: P) => setChosen(parts.filter(p => (p === part) !== chosen.includes(p)))

  return (
    <Modal
      title={t('game.printTitle')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" disabled={chosen.length === 0} onClick={() => onPrint(chosen)}>
            ⎙ {t('game.print')}
          </button>
        </>
      }
    >
      <div className="print-choices">
        {parts.map(part => (
          <label key={part} className="inline">
            <input type="checkbox" checked={chosen.includes(part)} onChange={() => toggle(part)} />
            {label(part)}
          </label>
        ))}
      </div>
      {children}
    </Modal>
  )
}
