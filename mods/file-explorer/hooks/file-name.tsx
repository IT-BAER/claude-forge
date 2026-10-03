import type { ClientModule } from 'claude-code'

type Props = { path: string; name: string; dim: boolean; picked: string; ack: { instance: string; seq: number } | null }
type Click = { seq: number; ctrl: boolean; canDouble: boolean }
type State = {
  instance: string
  seq: number
  pending: Click[]
  armed: boolean
  cancel?: () => void
  down?: { x: number; y: number; ctrl: boolean }
}

const FileName: ClientModule<Props, State> = (props, surface) => {
  const { Text } = surface.elements
  const state: State = surface.state ?? { instance: crypto.randomUUID(), seq: 0, pending: [], armed: false }
  if (!surface.state) surface.setState(state)
  const reset = () => { state.cancel?.(); state.cancel = undefined; state.armed = false }
  if (props.ack?.instance === state.instance) state.pending = state.pending.filter(click => click.seq > props.ack!.seq)
  surface.onPointer(e => {
    if (e.type === 'move' && state.down && (Math.abs(e.x - state.down.x) > 1 || e.y !== state.down.y)) {
      state.down = undefined
      reset()
    }
    if (e.type === 'down' && e.button !== 'left') reset()
    if (e.type === 'down' && e.button === 'left') {
      state.down = { x: e.x, y: e.y, ctrl: !!e.ctrl }
      return
    }
    if (e.type !== 'up' || e.button !== 'left') return
    const down = state.down
    state.down = undefined
    if (!down || e.x < 0 || e.y !== 0 || e.x >= surface.columns || Math.abs(e.x - down.x) > 1 || e.y !== down.y) return
    if (state.pending.length >= 32) return
    const ctrl = down.ctrl || !!e.ctrl
    const canDouble = !ctrl && state.armed
    reset()
    if (!ctrl) {
      state.armed = true
      state.cancel = surface.every(500, reset)
    }
    state.pending.push({ seq: ++state.seq, ctrl, canDouble })
    surface.post({ path: props.path, instance: state.instance, clicks: state.pending.map(click => ({ ...click })) })
  })
  return <Text dimColor={props.dim} wrap="truncate-end">{props.name}</Text>
}

export default FileName
