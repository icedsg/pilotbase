import { useStore } from '../../store'
import MigrationObjectPicker from './MigrationObjectPicker'
import MigrationPlanReview from './MigrationPlanReview'
import MigrationRunView from './MigrationRunView'

export default function MigrationFlow() {
  const { migrationViewContext } = useStore()
  if (!migrationViewContext) return null

  switch (migrationViewContext.step) {
    case 'review':  return <MigrationPlanReview />
    case 'running': return <MigrationRunView />
    case 'objects':
    default:
      return <MigrationObjectPicker />
  }
}
