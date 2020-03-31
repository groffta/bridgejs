'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _get = function get(object, property, receiver) { if (object === null) object = Function.prototype; var desc = Object.getOwnPropertyDescriptor(object, property); if (desc === undefined) { var parent = Object.getPrototypeOf(object); if (parent === null) { return undefined; } else { return get(parent, property, receiver); } } else if ("value" in desc) { return desc.value; } else { var getter = desc.get; if (getter === undefined) { return undefined; } return getter.call(receiver); } };

function _toConsumableArray(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) { arr2[i] = arr[i]; } return arr2; } else { return Array.from(arr); } }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var EventEmitter = require('events');

var Bridge = function (_EventEmitter) {
  _inherits(Bridge, _EventEmitter);

  function Bridge() {
    _classCallCheck(this, Bridge);

    var _this = _possibleConstructorReturn(this, (Bridge.__proto__ || Object.getPrototypeOf(Bridge)).call(this));

    _this.peers = [];
    _this.call_queue = [];
    _this._local_functions = [];
    _this.state = {};
    _this.id = uuid();
    _this.handler = {
      set: function (target, property, value) {
        var local = !value.origin;
        var origin = value.origin;
        var sender = value.sender;
        value = local ? value : value.value;

        var type = typeof value === 'undefined' ? 'undefined' : _typeof(value);

        if (type === 'object') {
          this.setObj(target, property, value, origin, sender);
        } else if (type !== 'function') {
          this.setVar(target, property, value, origin, sender);
        } else {
          this.setFunc(target, property, value, origin, sender);
        }
        return true;
      }.bind(_this),

      get: function get(target, property) {
        if (!target.hasOwnProperty(property)) {
          return undefined;
        } else {
          return target[property];
        }
      }
    };

    _this.state = new Proxy(_this.state, _this.handler);
    _this.on('registered', _this.sync.bind(_this));
    return _this;
  }

  _createClass(Bridge, [{
    key: 'setVar',
    value: function setVar(state, name, value, origin, sender) {
      var _this2 = this;

      if (origin) {
        // Originated from network
        this.peers.forEach(function (peer) {
          if (peer.id === origin || peer.id === sender) return;
          _this2.send(peer.id, 'varSet', name, value, origin);
        });

        state[name] = value;
      } else {
        // Originated from assignment
        this.peers.forEach(function (peer) {
          _this2.send(peer.id, 'varSet', name, value);
        });

        state[name] = value;
      }

      this.emit('varSet', { name: name, value: value, origin: origin, sender: sender });
    }
  }, {
    key: 'setFunc',
    value: function setFunc(state, name, value, origin, sender) {
      var _this3 = this;

      if (origin) {
        // remote function assignment
        this.peers.forEach(function (peer) {
          if (peer.id === origin || peer.id === sender) return;
          _this3.send(peer.id, 'funcSet', name, value, origin);
        });

        state[name] = value;
      } else {
        // local function assignment
        this.peers.forEach(function (peer) {
          if (peer.id != sender) _this3.send(peer.id, 'funcSet', name, value);
        });
        state[name] = value;
        this._local_functions.push(name);
      }
      this.emit('funcSet', { name: name, value: value, origin: origin, sender: sender });
    }
  }, {
    key: 'emitEvent',
    value: function emitEvent(name, value, origin, sender) {
      var _this4 = this;

      if (origin) {
        this.peers.forEach(function (peer) {
          if (peer.id != sender || peer.id != origin) _this4.send(peer.id, 'event', name, value);
        });
      }
      _get(Bridge.prototype.__proto__ || Object.getPrototypeOf(Bridge.prototype), 'emit', this).call(this, name, value);
    }
  }, {
    key: 'setObj',
    value: function setObj(state, name, value, origin, sender) {
      throw Error('Objects not yet supported');
      return;

      state[name] = new Proxy(value, this.handler);
      this.emit('change', {
        type: 'objSet',
        target: name,
        value: state[name]
      });
    }
  }, {
    key: 'call',
    value: function call(name) {
      var args = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : [];

      var _this5 = this;

      var rr = arguments[2];
      var meta = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : {};

      if (!meta.owner) meta.owner = this.id; // Setup default metadata
      if (!meta.origin) meta.origin = this.id;
      if (!meta.call_id) meta.call_id = uuid();
      if (!meta.path) meta.path = [];

      meta.path.push(this.id); // add our ID to the message path

      if (meta.owner === this.id) {
        var retval = undefined;
        var error = undefined;
        try {
          var _state;

          var _retval = (_state = this.state)[name].apply(_state, _toConsumableArray(args)); // Call function if target is local
          rr[0](_retval); // Resolve local call promise
        } catch (e) {
          rr[1](e.message);
          error = e.message;
        }
        this.peers.forEach(function (peer) {
          // broadcast return value if remote call origin
          peer.ws.send(JSON.stringify({
            type: error ? 'funcReject' : 'funcReturn',
            from: _this5.id,
            origin: _this5.id,
            id: meta.call_id,
            value: error ? error : retval
          }));
        });
      } else {
        // Send network request to call remote function
        this.peers.forEach(function (peer) {
          if (!meta.path.includes(peer.id)) {
            peer.ws.send(JSON.stringify({
              type: 'funcCall',
              from: _this5.id,
              origin: meta.origin,
              owner: meta.owner,
              name: name,
              args: args,
              id: meta.call_id,
              path: meta.path
            }));
          }
        });
      }
      if (meta.origin === this.id) {
        this.call_queue[meta.call_id] = {
          rr: rr,
          timeout: setTimeout(function () {
            rr[1]('Remote call response timeout');
          }, 1000)
        };
      }
    }
  }, {
    key: 'emit',
    value: function emit(name, value) {
      var remote = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : false;

      var args = [];
      var _iteratorNormalCompletion = true;
      var _didIteratorError = false;
      var _iteratorError = undefined;

      try {
        for (var _iterator = arguments[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
          var a = _step.value;
          args.push(a);
        }
      } catch (err) {
        _didIteratorError = true;
        _iteratorError = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion && _iterator.return) {
            _iterator.return();
          }
        } finally {
          if (_didIteratorError) {
            throw _iteratorError;
          }
        }
      }

      if (remote) {
        this.emitEvent.apply(this, [args[0]].concat(_toConsumableArray(args.slice(1))));
      } else {
        var _get2;

        (_get2 = _get(Bridge.prototype.__proto__ || Object.getPrototypeOf(Bridge.prototype), 'emit', this)).call.apply(_get2, [this, args[0]].concat(_toConsumableArray(args.slice(1))));
      }
    }
  }, {
    key: 'send',
    value: function send(peer_id, type, name, val) {
      var origin = arguments.length > 4 && arguments[4] !== undefined ? arguments[4] : this.id;
      // Send message to another peer
      var peer = this.peers.filter(function (p) {
        return p.id === peer_id;
      })[0];
      if (!peer) {
        throw new Error('Peer ID ' + peer_id + ' not registered');
        return;
      }

      if (type === 'varSet') {
        // Send a Variable
        peer.ws.send(JSON.stringify({
          from: this.id,
          origin: origin,
          type: type,
          name: name,
          value: val
        }));
      } else if (type === 'funcSet') {
        // Send a Function
        peer.ws.send(JSON.stringify({
          from: this.id,
          origin: origin,
          type: type,
          name: name
        }));
      } else if (type === 'event') {
        peer.ws.send(JSON.stringify({
          from: this.id,
          origin: origin,
          type: type,
          name: name,
          value: val
        }));
      } else {
        throw new Error('Invalid message type: ' + type + ' ');
        return;
      }
    }
  }, {
    key: 'recieve',
    value: function recieve(msg) {
      var _this7 = this;

      if (msg.data.match(/hello from */)) {
        // Initial peer handshake
        var id = msg.data.split(' ')[2];
        if (this.peers.filter(function (p) {
          return p.id === id;
        }).length) {
          var peer = this.peers.filter(function (p) {
            return p.id === id;
          })[0];
          peer.ws = msg.target;
          this.emit('registered', peer);
        } else {
          var _peer = {
            ws: msg.target,
            id: msg.data.split(' ')[2]
          };
          this.peers.push(_peer);
          this.emit('registered', _peer);
        }
        return;
      }

      var obj = JSON.parse(msg.data); // Parse Incoming Message
      this.emit('message', obj);

      if (obj.type === 'varSet') {
        // Variable Sync
        this.state[obj.name] = {
          value: obj.value,
          origin: obj.origin,
          sender: obj.from
        };
      }

      if (obj.type === 'funcSet') {
        // Function Proxy
        this.state[obj.name] = {
          value: function () {
            var _this6 = this,
                _arguments = arguments;

            return new Promise(function (resolve, reject) {
              // Call remote function
              _this6.call(obj.name, _arguments, [resolve, reject], {
                owner: obj.origin,
                origin: _this6.id
              });
            });
          }.bind(this),
          origin: obj.origin,
          sender: obj.from
        };
      }
      if (obj.type === 'event') {
        this.emitEvent(obj.name, obj.value, obj.origin, obj.from);
      }
      if (obj.type === 'funcCall') {
        // Remote function call
        var args = Object.values(obj.args);
        this.call(obj.name, args, [function () {}, function () {}], {
          owner: obj.owner,
          origin: obj.origin,
          call_id: obj.id,
          path: obj.path
        });
      }
      if (obj.type === 'funcReturn' || obj.type === 'funcReject') {
        // Function return value
        if (Object.keys(this.call_queue).includes(obj.id)) {
          if (obj.type === 'funcReturn') this.call_queue[obj.id]['rr'][0](obj.value);
          if (obj.type === 'funcReject') this.call_queue[obj.id]['rr'][1](obj.value);
          clearTimeout(this.call_queue[obj.id]['timeout']);
          delete this.call_queue[obj.id];
        } else {
          // Otherwise forward
          this.peers.forEach(function (peer) {
            if (peer.id != obj.from && peer.id != obj.origin) {
              obj.from = _this7.id;
              peer.ws.send(JSON.stringify(obj));
            }
          });
        }
      }
    }
  }, {
    key: 'register',
    value: function register(ws) {
      var _this8 = this;

      ws.onmessage = this.recieve.bind(this);
      ws.onclose = function (e) {
        _this8.peers = _this8.peers.filter(function (p) {
          return p.ws != e.target;
        });
      };
      ws.send('hello from ' + this.id);
    }
  }, {
    key: 'sync',
    value: function sync(peer) {
      for (var item in this.state) {
        if (typeof this.state[item] != 'function') {
          this.send(peer.id, 'varSet', item, this.state[item]);
        } else if (this._local_functions.includes(item)) {
          this.send(peer.id, 'funcSet', item, this.state[item]);
        }
      }
    }
  }]);

  return Bridge;
}(EventEmitter);

exports.Bridge = Bridge;


var uuid = function uuid() {
  // UUID Generator
  var s4 = function s4() {
    return Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
  };
  return s4() + s4() + '-' + s4() + '-' + s4() + '-' + s4() + '-' + s4() + s4() + s4();
};