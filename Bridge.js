const EventEmitter = require('events')

class Bridge extends EventEmitter {
  constructor() {
    super()
    this.peers = []
    this.call_queue = []
    this._local_functions = []
    this.state = {}
    this.id = uuid()
    this.handler = {
      set: function(target, property, value) {
        let local = !value.origin
        let origin = value.origin
        let sender = value.sender
        value = local ? value : value.value

        let type = typeof(value)


        if(type === 'object') {
          this.setObj(target, property, value, origin, sender)
        } else if(type !== 'function'){
          this.setVar(target, property, value, origin, sender)
        } else {
          this.setFunc(target, property, value, origin, sender)
        }
        return true
      }.bind(this),

      get: function(target, property) {
        if(!target.hasOwnProperty(property)){
          return undefined
        } else {
          return target[property]
        }
      }
    }

    this.state = new Proxy(this.state, this.handler)
    this.on('registered', this.sync.bind(this))
  }

  setVar(state, name, value, origin, sender) {

    if(origin) {                                                                // Originated from network
      this.peers.forEach((peer) => {
        if(peer.id === origin || peer.id === sender) return
        this.send(peer.id, 'varSet', name, value, origin)
      })

      state[name] = value
    } else {                                                                    // Originated from assignment
      this.peers.forEach((peer) => {
        this.send(peer.id, 'varSet', name, value)
      })

      state[name] = value
    }

    this.emit('varSet', {name: name, value: value, origin: origin, sender: sender})
  }

  setFunc(state, name, value, origin, sender) {
    if(origin) {                                                                // remote function assignment
      this.peers.forEach((peer) => {
        if (peer.id === origin || peer.id === sender) return
        this.send(peer.id, 'funcSet', name, value, origin)
      })

      state[name] = value

    } else {                                                                    // local function assignment
      this.peers.forEach((peer) => {
        if(peer.id != sender) this.send(peer.id, 'funcSet', name, value)
      })
      state[name] = value
      this._local_functions.push(name)
    }
    this.emit('funcSet', {name: name, value: value, origin: origin, sender: sender})
  }

  emitEvent(name, value, origin, sender) {
    if(origin){
      this.peers.forEach((peer) => {
        if(peer.id != sender || peer.id != origin) this.send(peer.id, 'event', name, value)
      })
    }
    super.emit(name, value)
  }

  setObj(state, name, value, origin, sender) {
    throw Error('Objects not yet supported')
    return

    state[name] = new Proxy(value, this.handler)
    this.emit('change', {
      type: 'objSet',
      target: name,
      value: state[name]
    })
  }

  call(name, args=[], rr, meta={}) {
    if(!meta.owner) meta.owner = this.id                                        // Setup default metadata
    if(!meta.origin) meta.origin = this.id
    if(!meta.call_id) meta.call_id = uuid()
    if(!meta.path) meta.path = []

    meta.path.push(this.id)                                                     // add our ID to the message path

    if(meta.owner === this.id){
      let retval = this.state[name](...args)                                    // Call function if target is local
      rr[0](retval)                                                             // Resolve local call promise
      this.peers.forEach((peer) => {                                            // broadcast return value if remote call origin
        peer.ws.send(JSON.stringify({
          type: 'funcReturn',
          from: this.id,
          origin: this.id,
          id: meta.call_id,
          value: retval
        }))
      })
    } else {                                                                    // Send network request to call remote function
      this.peers.forEach((peer) => {
        if(!meta.path.includes(peer.id)){
          peer.ws.send(JSON.stringify({
            type: 'funcCall',
            from: this.id,
            origin: meta.origin,
            owner: meta.owner,
            name: name,
            args: args,
            id: meta.call_id,
            path: meta.path
          }))
        }
      })
    }
    if(meta.origin === this.id){
      this.call_queue[meta.call_id] = {
        rr: rr,
        timeout: setTimeout(() => {
          rr[1]('Remote call response timeout')
        }, 1000)
      }
    }
  }

  emit(name, value, remote=false) {
    let args = []
    for(let a of arguments) args.push(a)

    if(remote){
      this.emitEvent(args[0], ...args.slice(1))
    }else{
      super.emit(args[0], ...args.slice(1))
    }
  }

  send(peer_id, type, name, val, origin=this.id) {                              // Send message to another peer
    let peer = this.peers.filter((p) => p.id === peer_id)[0]
    if(!peer) {
      throw new Error(`Peer ID ${peer_id} not registered`)
      return
    }

    if(type === 'varSet') {                                                     // Send a Variable
      peer.ws.send(JSON.stringify({
        from: this.id,
        origin: origin,
        type: type,
        name: name,
        value: val
      }))
    } else if(type === 'funcSet') {                                             // Send a Function
      peer.ws.send(JSON.stringify({
        from: this.id,
        origin: origin,
        type: type,
        name: name,
      }))
    } else if (type === 'event'){
      peer.ws.send(JSON.stringify({
        from: this.id,
        origin: origin,
        type: type,
        name: name,
        value: val
      }))
    } else {
      throw new Error(`Invalid message type: ${type} `)
      return
    }
  }

  recieve(msg){
    if(msg.data.match(/hello from */)) {                                        // Initial peer handshake
      let id = msg.data.split(' ')[2]
      if(this.peers.filter((p) => p.id === id).length){
        let peer = this.peers.filter((p) => p.id === id)[0]
        peer.ws = msg.target
        this.emit('registered', peer)
      }else{
        let peer = {
          ws: msg.target,
          id: msg.data.split(' ')[2]
        }
        this.peers.push(peer)
        this.emit('registered', peer)
      }
      return
    }

    let obj = JSON.parse(msg.data)                                              // Parse Incoming Message

    this.emit('message', obj)

    if(obj.type === 'varSet'){                                                  // Variable Sync
      this.state[obj.name] = {
        value: obj.value,
        origin: obj.origin,
        sender: obj.from
      }
    }

    if(obj.type === 'funcSet'){                                                 // Function Proxy
      this.state[obj.name] = {
        value: function(){
          return new Promise((resolve, reject) => {
            // Call remote function
            this.call(obj.name, arguments, [resolve, reject], {
              owner: obj.origin,
              origin: this.id
            })
          })
        }.bind(this),
        origin: obj.origin,
        sender: obj.from
      }
    }
    if(obj.type === 'event'){
      this.emitEvent(obj.name, obj.value, obj.origin, obj.from)
    }
    if(obj.type === 'funcCall'){                                                // Remote function call
      let args = Object.values(obj.args)
      this.call(obj.name, args, [()=>{},()=>{}], {
        owner: obj.owner,
        origin: obj.origin,
        call_id: obj.id,
        path: obj.path
      })
    }

    if(obj.type === 'funcReturn'){                                              // Function return value
      if(Object.keys(this.call_queue).includes(obj.id)){
        this.call_queue[obj.id]['rr'][0](obj.value)                             // Resolve if our call queue contains the return target
        clearTimeout(this.call_queue[obj.id]['timeout'])
        delete this.call_queue[obj.id]
      } else {                                                                  // Otherwise forward
        this.peers.forEach((peer) => {
          if(peer.id != obj.from && peer.id != obj.origin){
            obj.from = this.id
            peer.ws.send(JSON.stringify(obj))
          }
        })
      }
    }
  }

  register(ws){
    ws.onmessage = this.recieve.bind(this)
    ws.onclose = (e) => {
      this.peers = this.peers.filter((p) => p.ws != e.target)
    }
    ws.send(`hello from ${this.id}`)
  }

  sync(peer) {
    for(let item in this.state){
      if(typeof this.state[item] != 'function') {
        this.send(peer.id, 'varSet', item, this.state[item])
      } else if(this._local_functions.includes(item)){
        this.send(peer.id, 'funcSet', item, this.state[item])
      }
    }
  }
}

export { Bridge }

let uuid = () => {                                                              // UUID Generator
    let s4 = () => {
        return Math.floor((1 + Math.random()) * 0x10000)
            .toString(16)
            .substring(1);
    }
    return s4() + s4() + '-' + s4() + '-' + s4() + '-' + s4() + '-' + s4() + s4() + s4();
}
