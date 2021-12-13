let dots = ''
process.stdout.write(`Loading `)

let tmrID = setInterval(() => {
  dots += '.'
  process.stdout.write(`\rLoading ${dots}`)
}, 1000)

setTimeout(() => {
  clearInterval(tmrID)
  console.log(`\rLoaded in [3500 ms]`)
}, 3500)