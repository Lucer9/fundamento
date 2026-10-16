/** semaforo.carlosaguirre.workers.dev, the traffic site's first name: every path moves to Maneja Sin Broncas. */
export default {
  fetch(request) {
    const url = new URL(request.url)
    url.hostname = 'manejasinbroncas.carlosaguirre.workers.dev'
    return Response.redirect(url.toString(), 301)
  },
}
