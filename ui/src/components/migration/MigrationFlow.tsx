import type { MigrationTab } from '../../store'
import MigrationObjectPicker from './MigrationObjectPicker'
import MigrationPlanReview from './MigrationPlanReview'
import MigrationRunView from './MigrationRunView'

export default function MigrationFlow({ tab }: { tab: MigrationTab }) {
  switch (tab.step) {
    case 'review':  return <MigrationPlanReview tab={tab} />
    case 'running': return <MigrationRunView tab={tab} />
    case 'objects':
    default:
      return <MigrationObjectPicker tab={tab} />
  }
}
