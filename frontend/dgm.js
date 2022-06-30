export function degToDM (degs, lat) {
  let dir = ''
  if (degs < 0) {
    degs = degs * -1
    dir = lat ? 'S' : 'W'
  } else {
    dir = lat ? 'N' : 'E'
  }
  const d = Math.floor(degs)
  const mins = ((degs - d) * 60).toFixed(3)

  return d + ' ' + mins + ' ' + dir
}

export function DMToDegrees (degMinStr) {
  const parts = degMinStr.split(' ')
  const d = parseInt(parts[0])
  const mins = parseFloat(parts[1])
  const dir = parts[2]
  const dec = mins / 60
  let degs = d + dec
  if (dir === 'S' || dir === 'W') {
    degs = degs * -1
  }
  return degs
}
