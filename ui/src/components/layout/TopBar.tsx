import Logo from '../common/Logo'
import { useStore } from '../../store'

export default function TopBar() {
  const { setVectorViewContext, setNosqlViewContext, setMigrationViewContext } = useStore()

  const resetToNormalView = () => {
    setVectorViewContext(null)
    setNosqlViewContext(null)
    setMigrationViewContext(null)
  }

  return (
    <header className="h-11 flex items-center px-3 bg-surface-300 border-b border-surface-50 flex-shrink-0">
      <Logo size="sm" onClick={resetToNormalView} />
    </header>
  )
}
