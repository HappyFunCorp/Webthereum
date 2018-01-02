// Set up web server
const express = require('express'); 
const helmet = require('helmet');
const app = express();
const port = process.env.PORT || 8801;
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const express_enforces_ssl = require('express-enforces-ssl');
// TODO: uncomment in production!
// app.enable('trust proxy'); // To force SSL on eg Heroku
// TODO: uncomment in production!
// app.use(express_enforces_ssl());


// Ethereum client setup / data
const contractAddress = undefined; // TODO

const abi = [{"constant":false,"inputs":[{"name":"prizeId","type":"uint256"},{"name":"geohash","type":"bytes10"},{"name":"_metadata","type":"string"}],"name":"placePrize","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[{"name":"prizeId","type":"uint256"},{"name":"geohash","type":"bytes10"}],"name":"claimPrize","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[{"name":"","type":"uint256"}],"name":"prizes","outputs":[{"name":"id","type":"uint256"},{"name":"owner","type":"address"},{"name":"geohash","type":"bytes10"},{"name":"metadata","type":"string"},{"name":"placedAt","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"inputs":[],"payable":false,"stateMutability":"nonpayable","type":"constructor"}];

const Web3 = require('web3');
const web3 = new Web3(new Web3.providers.HttpProvider("https://rinkeby.infura.io/"));


// Set up database
const { Pool } = require('pg');
const local_db_url = 'postgres://localhost:5432/webthereum';
const db_url = process.env.DATABASE_URL || local_db_url;
require('pg').defaults.ssl = db_url != local_db_url;
const pool = new Pool({ connectionString: db_url });
pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client', err);
  console.error('client is', client);
  process.exit(-1);
});

const db_creation_string = `
  CREATE TABLE IF NOT EXISTS prizes(id SERIAL PRIMARY KEY, created_at timestamp with time zone NOT NULL DEFAULT current_timestamp, updated_at timestamp NOT NULL DEFAULT current_timestamp, latestTxn CHAR(66), prizeData TEXT);
  CREATE TABLE IF NOT EXISTS transactions(id SERIAL PRIMARY KEY, created_at timestamp with time zone NOT NULL DEFAULT current_timestamp, updated_at timestamp NOT NULL DEFAULT current_timestamp, prizeId INT, txnState INT not null, txnHash CHAR(66) not null, arguments TEXT, txnData TEXT, txnReceipt TEXT);
  CREATE INDEX IF NOT EXISTS idTxnHash ON transactions(txnHash);
`;


// Enforce HTTPS in non-local environments
app.use((request, response, next) => {
  if (request.hostname == "localhost" || request.hostname == "127.0.0.1" || request.secure) {
    next();
  } else {
    response.send("Insecure request on non-localhost server! Uncomment express_enforces_ssl usage.");
  }
});

// Some minimal error handling
app.use((err, request, response, next) => {  
  console.log(err);
  response.status(500).send('Something broke! '+ JSON.stringify(err));
  next();
});


// Create database. Does nothing if already created.
app.get('/create', (req, response) => {
  pool.query(db_creation_string, (err, res) => {
    if (err) {
      response.json( {"err": ""+err} );
    } else {
      response.send( "Database created: " + res );
    }
  });
});

// Home page
app.get('/', (req, response) => {
  var html = "<HTML><HEAD><TITLE>Webthereum Tutorial</TITLE></HEAD><BODY>";
  html += "<H3>View</H3>";
  html += "<FORM action='prize'><SELECT name='prizeId'>";
  for (var i=1; i<=10; i++) {
    html += "<OPTION>"+i;
  }
  html += "</SELECT><INPUT type='submit'></FORM>";
  html += "<HR/>";
  html += "<H3>Place</H3>";
  html += "<FORM action='place' method='post'><SELECT name='prizeId'>";
  for (var j=1; j<=10; j++) {
    html += "<OPTION>"+j;
  }
  html += "</SELECT>";
  html += "<INPUT type='text' name='senderAddress' placeholder='Sender Address'>";
  html += "<INPUT type='password' name='privateKey' placeholder='Private Key'>";
  html += "<INPUT type='text' name='geohash' placeholder='Geohash'>";
  html += "<INPUT type='text' name='metadata' placeholder='Metadata'>";
  html += "<INPUT type='submit'></FORM>";
  html += "<HR/>";
  html += "<H3>Claim</H3>";
  html += "<FORM action='claim' method='post'><SELECT name='prizeId'>";
  for (var k=1; k<=10; k++) {
    html += "<OPTION>"+k;
  }
  html += "</SELECT>";
  html += "<INPUT type='text' name='senderAddress' placeholder='Sender Address'>";
  html += "<INPUT type='password' name='privateKey' placeholder='Private Key'>";
  html += "<INPUT type='text' name='geohash' placeholder='Geohash'>";
  html += "<INPUT type='submit'></FORM>";
  html += "<HR/>";
  html += "<a href='/prizes'>View Current Prize Data Cache</a>";
  html += "</BODY></HTML>";
  response.send(html);
});

// List all the prizes that the database knows about, with their raw JSON data.
app.get('/prizes', (req, response) => {
  var html = "<HTML><HEAD><TITLE>Webthereum Tutorial</TITLE></HEAD><BODY>";
  html += "<H3>Prizes</H3>";
  html += "<P>This shows the contents of the local database. Actual blockchain data may now vary.</P>";
  html += "<TABLE><TR><TH>ID</TH><TH>Owner</TH><TH>Geohash</TH><TH>Placed At</TH><TH>Metadata</TH><TH>Latest DB Txn</TH><TH>State</TH></TR>";
  pool.query("SELECT * FROM Prizes p LEFT OUTER JOIN Transactions t ON p.latestTxn = t.txnHash ORDER BY p.id", [], (err, res) => {
    if (err) {
      console.log("select prizes error", err);
      html += "Could not get prizes from database";
      response.send(html);
      return;
    }
    for (var i = 0; i < res.rows.length; i++) {
      var row = res.rows[i];
      var prize = JSON.parse(row.prizedata);
      var owner = prize.owner == '0x0000000000000000000000000000000000000000' ? "" : prize.owner;
      var txnLink = row.latesttxn === null ? '' : "<a href='/checkTxn?txnHash=" + row.latesttxn + "'>view</a>";
      var state = res.rows[i].txnstate;
      state = (!state || state == -1) ? "Undefined" : state === 0 ? "Pending" : state == 1 ? "Mined" : state == 2 ? "Failed" : "Success";
      html += "<TR><TD>" + prize.id + "</TD><TD>" + owner + "</TD><TD>" + web3.utils.hexToAscii(prize.geohash);
      html += "</TD><TD>" + prize.placedAt + "</TD><TD>" + prize.metadata + "</TD><TD>" + txnLink + "</TD><TD>" + state + "</TD></TR>";
    }
    html += "</TABLE></BODY></HTML>";
    response.send(html);
  });
});

// Display the prize data, if any
app.get('/prize', (req, response) => {
  get_prize_data(req.query.prizeId, function(err, res) {
    if (err) {
      response.json( {"err": err} );
    } else {
      var dbId = req.query.prizeId;
      var dbData = JSON.stringify(res);
      pool.query("INSERT INTO Prizes (id, prizeData) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET prizeData = $2;", [dbId, dbData], (dberr) => {
        if (dberr) {
          response.json( {"err": ""+dberr, "res" : res} );
          return;
        }
        response.json( {"prize" : res} );
      });
    }
  });
});

// Place a prize
app.post('/place', (req, response) => {
  console.log("req", JSON.stringify(req.body));
  place_prize(req.body.prizeId, req.body.geohash, req.body.metadata, req.body.senderAddress, req.body.privateKey, function(err, txnHash) {
    if (err) {
      response.json( {"err": ""+err, "txnHash" : txnHash} );
      return;
    }
    response.send("Placement submitted: txn "+txnHash);
  });
});

// Register a site as taken, with image URL
app.post('/claim', (req, response) => {
  claim_prize(req.body.prizeId, req.body.geohash, req.body.senderAddress, req.body.privateKey, function(err, txnHash) {
    if (err) {
      response.json( {"err": ""+err, "txnHash" : txnHash} );
      return;
    }
    response.send("Claim submitted: txn "+txnHash);
  });
});

// Check a transaction
app.get('/checkTxn', (req, response) => {
  get_eth_txn_receipt(req.query.txnHash, function(err, result) {
    if (result) {
      response.json({"txnHash" : req.query.txnHash, "data" : result});
    } else {
      get_eth_txn_data(req.query.txnHash, function(err2, result) {
        if (result) {
          response.json({"txnHash" : req.query.txnHash, "data" : result});
        } else {
          response.json({"err" : err2, "receiptErr" : err});
        }
      });
    }
  });
});

app.listen(port, (err) => {  
  if (err) {
    return console.log('something bad happened', err);
  }
  console.log(`server is listening on ${port}`);
});


//
// Ethereum calls
//

const STATE_UNDEFINED = -1;
const STATE_PENDING   = 0;
const STATE_MINED     = 1;
const STATE_FAILED    = 2;
const STATE_SUCCESS   = 3;


// Get prize data
var get_prize_data = function(prizeId, callback) {
  var contract = new web3.eth.Contract(abi, contractAddress);
  contract.methods.prizes(prizeId).call(function(error, result) {
    if (error) {
      console.log('error', error);
      callback(error, null);
    } else {
      console.log('result', result);
      callback(null, result);
    }
  })
  .catch(function(error) {
    console.log('call error ' + error);
    callback(error, null);
  });
};

// Get initial ethereum transaction data
function get_eth_txn_data(txnHash, callback) {
  // do we have the data?
  pool.query("SELECT txnData, txnState FROM Transactions WHERE txnHash = $1", [txnHash], (err, res) => {
    if (err) {
      console.log("select error", err);
      callback(err, null);
      return;
    }
    if (res.rows.length === 0) {
      console.log("transaction not found", txnHash);
      callback("Transaction not found!", null);
      return;
    }

    var dbState = res.rows[0].txnstate ? res.rows[0].txnstate : STATE_UNDEFINED;
    var dbData = res.rows[0].txndata ? JSON.parse(res.rows[0].txndata) : null;
    if (dbState >= STATE_MINED && dbData) {
      callback(null, dbData);
      return;
    }

    web3.eth.getTransaction(txnHash).then((txnData) => {
      var txnState = dbState;
      if (dbState <= STATE_PENDING) {
        txnState = txnData.blockNumber === null ? STATE_PENDING : STATE_MINED;
      }
      pool.query("UPDATE Transactions SET txnData = $1, txnState = $2 WHERE txnHash = $3", [JSON.stringify(txnData), txnState, txnHash], (err) => {
        if (err) {
          console.log("update error", err);
          callback(err, txnData);
        } else {
          callback(null, txnData);
        }
      });
    }).catch((error) => {
      console.log("web3 txn data error", error);
      callback(error, null);
    });
  });
}

// Get processed ethereum transaction receipt
function get_eth_txn_receipt(txnHash, callback) {
  // do we have the receipt?
  pool.query("SELECT txnData, txnReceipt, txnState FROM Transactions WHERE txnHash = $1", [txnHash], (err, res) => {
    if (err) {
      console.log("select err", err);
      callback(err, null);
      return;
    }
    if (res.rows.length === 0) {
      console.log("txn not found", txnHash);
      callback("Transaction not found!", null);
      return;
    }

    var dbReceipt = res.rows[0].txnreceipt ? JSON.parse(res.rows[0].txnreceipt) : null;
    if (dbReceipt) {
      var dbData = res.rows[0].txndata ? JSON.parse(res.rows[0].txndata) : null;
      var dbState = res.rows[0].txnstate ? res.rows[0].txnstate : STATE_UNDEFINED;
      callback(null, { "state" : dbState, "receipt" : dbReceipt, "initialData" : dbData });
      return;
    }

    web3.eth.getTransactionReceipt(txnHash).then((receipt) => {
      var txnState = receipt.status === "0x1" ? STATE_SUCCESS : STATE_FAILED;
      pool.query("UPDATE Transactions SET txnReceipt = $1, txnState = $2 WHERE txnHash = $3", [JSON.stringify(receipt), txnState, txnHash], (err) => {
        if (err) {
          console.log("update err", err);
          callback(err, receipt);
        } else {
          callback(null, {"receipt" : receipt});
        }
      });
    }).catch((error) => {
      console.log("web3 receipt error", error);
      callback(error, null);
    });
  });
}

//
// Ethereum transactions
//

const GAS_LIMIT = 4000000; // should not be a constant if using real money
const GAS_PRICE = 20000000000; // should not be a constant if using real money

// Place a prize
function place_prize(prizeId, geohash, metadata, senderAddress, privateKey, callback) {
  web3.eth.getTransactionCount(senderAddress).then((txnCount) => {
    console.log("prizeId", prizeId);
    var contract = new web3.eth.Contract(abi, contractAddress);
    var geohashBytes = web3.utils.asciiToHex(geohash);
    var placeMethod = contract.methods.placePrize(prizeId, geohashBytes, metadata);
    var encodedABI = placeMethod.encodeABI();
    var placeTx = {
      from: senderAddress,
      to: contractAddress,
      nonce: web3.utils.toHex(txnCount),
      gasLimit: web3.utils.toHex(GAS_LIMIT),
      gasPrice: web3.utils.toHex(GAS_PRICE),
      data: encodedABI,
    };
    sendTxn(privateKey, placeTx, prizeId, {"args" : { "geohash" : geohash, "metadata" : metadata } }, callback );
  }).catch((err) => {
    console.log("web3 err", err);
    callback(err, null);
  });
}

// Claim a prize
function claim_prize(prizeId, geohash, senderAddress, privateKey, callback) {
  web3.eth.getTransactionCount(senderAddress).then((txnCount) => {
    var contract = new web3.eth.Contract(abi, contractAddress);
    var geohashBytes = web3.utils.asciiToHex(geohash);
    var claimMethod = contract.methods.claimPrize(prizeId, geohashBytes);
    var encodedABI = claimMethod.encodeABI();
    var claimTx = {
      from: senderAddress,
      to: contractAddress,
      nonce: web3.utils.toHex(txnCount),
      gasLimit: web3.utils.toHex(GAS_LIMIT),
      gasPrice: web3.utils.toHex(GAS_PRICE),
      data: encodedABI,
    };
    sendTxn(privateKey, claimTx, prizeId, {"args" : { "geohash" : geohash } }, callback );
  }).catch((err) => {
    console.log("web3 err", err);
    callback(err, null);
  });
}

function sendTxn(privateKey, rawTx, prizeId, args, callback) {
  var tx = require('ethereumjs-tx');
  var privateKeyBuffer = new Buffer(privateKey, 'hex');
  var transaction = new tx(rawTx);
  transaction.sign(privateKeyBuffer);
  var serializedTx = transaction.serialize().toString('hex');
  web3.eth.sendSignedTransaction(
  '0x' + serializedTx, function(err, txnHash) {
    if(err) {
      console.log("txn err", err);
      callback(err, null);
    } else {
      console.log("txn result", txnHash);
      pool.query("INSERT INTO Transactions (prizeId, txnHash, txnState, arguments) VALUES ($1, $2, $3, $4)", [prizeId, txnHash, STATE_PENDING, args], (err) => {
        if (err) {
          console.log("insert err", err);
          callback(err, txnHash);
        } else {
          pool.query("INSERT INTO Prizes (id, latestTxn) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET latestTxn = $2;", [prizeId, txnHash], (dberr) => {
            if (dberr) {
              callback(dberr, null);
            } else {
              callback(null, txnHash);
            }
          });
        }
      });
    }
  }).catch((err) => {
    callback(err, null);
  });
}
