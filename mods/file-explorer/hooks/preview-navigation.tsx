import type { ClientModule } from 'claude-code'

const PreviewNavigation: ClientModule<Record<string, never>, { down: boolean }> = (_, surface) => {
  const { Button } = surface.elements
  const state = surface.state ?? { down: false }
  if (!surface.state) surface.setState(state)
  const back = () => surface.post({ back: true })
  surface.onPointer(e => {
    if (e.type === 'down' && e.button === 'left') state.down = true
    if (e.type === 'up' && e.button === 'left') {
      const down = state.down
      state.down = false
      if (down && e.x >= 0 && e.y >= 0 && e.x < surface.columns && e.y < surface.rows) back()
    }
  })
  surface.onKey(e => { if (e.key === 'return' || e.key === ' ') back() })
  return <Button key="preview-back" label="← Files" variant="secondary" onPress={back} />
}

export default PreviewNavigation
