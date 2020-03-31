# Bridge.js
Bridge.js is an ES6 module designed to enable seamless functionality between networked applications by creating a transparent exchange layer on top of websockets
to act as a shared state object. This is done by utilizing Javascript proxy objects to intercept property assignment and sync the assigned values between networked instances. Bridge.js can be used in an arbitraty network topology by registering multiple nodes to each other.

## Functional Theory
A bridge node is created in each application after creating a websocket connection between the applications. Bridge.js does not handle the websocket connections, only acting as a framework to maintain a synced state. After establishing a websocket connection, the websocket object is registered with the bridge node and assigned a unique node ID for identification within the network. When a mutation is made to the bridge state object, the mutated property is first changed locally on the node, then a JSON message is sent to all registered bridge nodes. When a message is recieved by a bridge node, it is acted on locally before forwarding the message to all other registered bridge nodes. Each node appends it's node ID to the message to prevent reflections
and loops within the network topology. If a message has already been processed by a node, it will ignore the message if it receives it again.

Bridge.js is capable of syncing the following Javascript features:
*  Primitive assigment
*  Function assigment and calls
*  Events
*  *Values other than primitives are not yet supported*

### Primitive Assignment
Bridge.js utilizes javascript proxy objects to override the default behavior of some operators, primarily the assignment operator `=`.
when a primitive value is assigned to a state object property, *e.g.*
  
`bridge.state.foo = 'bar'`

the state object first assigns the string primitive `'bar'` to `state.foo` locally. Then a primitive-set message is sent to all registered nodes which interpret the message and assign the value locally before passing the message along. This method ensures that state properties stay consistent across the entire network.

### Function Assignment
When a function is assigned to a state property *e.g.*

`bridge.state.exampleFunction = function(a,b){ return a+b }`

like primitive assignment, the state object assigns the function locally and then passes a function-set message to the other registered nodes along with metadata containing the ID of the origin node. When a node receives a function-set message, the node creates a proxy function on its state object that sends a function-call message to the network requesting the function to be called on the origin node.

### Function Calls
when a function is called on a node's state object. It first checks if it is the origin node for the function. If so, it calls the function normally and returns the result. If the node is not the function origin, the called function returns a promise object that will be resolved when the network returns the function result from the origin. The remote function call is put into a queue containing the promise object and a unique call ID. a function-call message is then sent to the network containing the function call arguments, the call requester ID and the function origin ID. When the function origin node receives the function-call message, It tries to run the function locally and then sends a message back to the requester through the network containing either the return value or an error message.

### Events
Bridge.js extends the default functionality of an `EventEmitter` by sending an event message to the network so that any event handlers registered to a node on the network will respond to an event emitted from any node on the network. 

## Example
#### Server
```
import { Bridge } from '@groffta/bridgejs'
const ws = require('ws')

let bridge = new Bridge()

// Create shared function on the bridge state object
bridge.state.hello = function(){
  console.log('Hello BridgeJS!')
  return 'foobar'
}

// Register event listener for customEventName
bridge.on('customEventName', function(){
  console.log(bridge.state.foo)
})

// Wait for websocket connections and register them to the bridge
let wsServer = new ws.Server({ port: 9999 })
wsServer.on('connection', function(websocket){
  bridge.register(websocket)
})
```

#### Client 
```
import { Bridge } from '@groffta/bridgejs'
let bridge = new Bridge()

// Create a websocket connection to the server
let ws = new WebSocket('ws://serverURL:9999/')

ws.onopen = function() {
  bridge.register(ws)
  bridge.state.foo = 'bar'
  bridge.emit('customEventName')
  bridge.state.hello().then(function(response){
    console.log(response)
  })
}
```

**Server Console:**
```
> 'bar'
> Hello BridgeJS!
```
**Client Console:**
```
> foobar
```