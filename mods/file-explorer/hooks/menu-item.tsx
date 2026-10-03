import type { ClientModule } from 'claude-code'

type Props = { id: string; label: string; dim?: boolean }
type State = { armed: boolean }

// One row of the row menu: the whole region is the target, so a press anywhere on the row counts.
const MenuItem: ClientModule<Props, State> = (props, surface) => {
  const { Text } = surface.elements
  const state: State = surface.state ?? { armed: false }
  if (!surface.state) surface.setState(state)
  surface.onPointer(e => {
    if (e.type === 'leave') state.armed = false
    if (e.button !== 'left') return
    if (e.type === 'down') state.armed = true
    if (e.type !== 'up') return
    const armed = state.armed
    state.armed = false
    if (armed && e.x >= 0 && e.x < surface.columns && e.y === 0) surface.post({ id: props.id })
  })
  return <Text wrap="truncate-end" dimColor={props.dim}>{props.label}</Text>
}

export default MenuItem
