import type { ClientModule } from 'claude-code'

const ClearSelection: ClientModule<{ text: string; bold: boolean; padX: number }> = (props, surface) => {
  const { Box, Text } = surface.elements
  surface.onPointer(e => {
    if (e.type === 'down' && e.button === 'left') surface.post({ clear: true })
  })
  return <Box flexDirection="column" height="100%" paddingX={props.padX}>
    <Text bold={props.bold} dimColor={!props.bold} wrap="wrap">{props.text}</Text>
  </Box>
}

export default ClearSelection
