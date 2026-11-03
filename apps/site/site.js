// Realça o botão do sistema de quem está visitando e o coloca primeiro. Sem JS, os três aparecem iguais.
;(function () {
  var ua = navigator.userAgent || ''
  var platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || ''
  var os = null
  if (/iPhone|iPad|Android/i.test(ua)) os = null
  else if (/Mac/i.test(platform) || /Macintosh/.test(ua)) os = 'mac'
  else if (/Win/i.test(platform) || /Windows/.test(ua)) os = 'windows'
  else if (/Linux|X11/i.test(platform)) os = 'linux'
  var box = document.querySelector('[data-downloads]')
  if (!os || !box) return
  var long = { mac: 'Baixar para macOS', windows: 'Baixar para Windows', linux: 'Baixar para Linux' }
  var short = { mac: 'macOS', windows: 'Windows', linux: 'Linux' }
  var buttons = Array.prototype.slice.call(box.querySelectorAll('a[data-os]'))
  buttons.forEach(function (button) {
    var key = button.getAttribute('data-os')
    var primary = key === os
    button.classList.toggle('botao--secundario', !primary)
    button.textContent = primary ? long[key] : short[key]
    if (primary) box.insertBefore(button, box.firstChild)
  })
})()
