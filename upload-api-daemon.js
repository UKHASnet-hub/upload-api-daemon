var express = require('express')
var app = express()
var bodyParser = require('body-parser')
var http = require('http')
var server = http.createServer(app)
var port = 3002
var pg = require('pg')
var pgConfig = require('./config.json')

app.disable('x-powered-by');

console.log('HTTP: Setting up Functions..')

app.use(bodyParser())

// /upload - POST
// Uploads a packet into the database. NOTE: Does not parse it
app.post('/upload', function(req, res) {
    var since_time;
    if(!req.body.origin) {
        res.send(400,'No Origin Callsign (gateway) specified.')
        return
    }
    if(!req.body.data) {
        res.send(400,'No Data given.')
        return
    }
    var rssi=0;
    if(req.body.rssi) {
        rssi = req.body.rssi
    }
    pg.connect(pgConfig, function(err, client, done) {
        if(err) {
            res.send(500,'Database Connection Error')
            console.log('DB Connection Error: ', err)
            return
        }
        client.query('SELECT id FROM ukhasnet.nodes WHERE name = $1;', [req.body.origin], function(err, result) {
            if(err) {
                done()
                res.send(500,'Database Query Error')
                console.log('DB Query Error: ', err)
                return
            }
            if(result.rowCount==0) {
                client.query('INSERT INTO ukhasnet.nodes (name) VALUES ($1) RETURNING id;', [req.body.origin], function(err, result) {
                    if(err) {
                        done()
                        res.send(500,'Database Query Error')
                        console.log('DB Query Error: ', err)
                        return
                    }
                    upload_packet(res,client,done,req.body.origin,req.body.data,rssi,result.rows[0].id)
                })
            } else {
                upload_packet(res,client,done,req.body.origin,req.body.data,rssi,result.rows[0].id)
            }
        })
    })
})

function upload_packet(res,client,done,upload_origin,upload_data,upload_rssi,origin_id) {
    client.query('INSERT INTO ukhasnet.upload(nodeid,packet,rssi) VALUES($1,$2,$3) RETURNING id;', [origin_id,upload_data,upload_rssi], function(err, result) {
        if(err) {
            done()
            res.send(500,'Database Query Error')
            console.log('DB Query Error: ', err)
            return
        }
        client.query('SELECT upload.id AS uploadid,upload.nodeid as nodeid,nodes.name as nodename,upload.time as time,upload.packet as packet,upload.state as state, upload.rssi FROM ukhasnet.upload INNER JOIN ukhasnet.nodes ON upload.nodeid=nodes.id WHERE upload.id=$1;', [result.rows[0].id], function(err, result) {
            if(err) {
                done()
                res.send(500,'Database Query Error')
                console.log('DB Query Error: ', err)
                return
            }
            var notify_payload = {
                'i':result.rows[0].uploadid,
                'ni':result.rows[0].nodeid,
                'nn':htmlEntities(result.rows[0].nodename),
                't':result.rows[0].time,
                'p':htmlEntities(result.rows[0].packet),
                's':result.rows[0].state,
                'r':result.rows[0].rssi
            }
            var uploadNotify = client.query('SELECT pg_notify( \'upload_row\', $1 )',[notify_payload]);
            uploadNotify.on('error', function(err) {
                done()
                res.send(500,'Database Query Error')
                console.log('DB Query Error: ', err)
                return
            })
            uploadNotify.on('end', function(result) {
                done()
            })
            res.type('application/json');
            res.send(201, {'error':0, 'uploadid':result.rows[0].uploadid})
        })
    })
}

function htmlEntities(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

console.log('HTTP: Functions Initialised')

console.log('DB: Testing Connection..')

pg.connect(pgConfig, function(err, client, done) {
    if(err) {
        console.log('DB: Connection Error: ', err)
        return
    }
    client.query('SELECT 1;', function(err, result) {
        done()
        if(err) {
            console.log('DB: Query Error: ', err)
            return
        } else {
            console.log('DB: Connection OK')
            start_api()
        }
    })
})

function start_api() {
    server.listen(port)
    console.log('ukhas.net upload v0.3 now running on port '+port)
}
