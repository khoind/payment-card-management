const express = require('express')
const app = express()
const morgan = require('morgan')

const {
    updateBalance,
    updateUnusedLimit,
    formatter,
    issueId,
    findCardById,
    checkTimeGap,
    reconstructCard
} = require('./helpers.js');

app.use(morgan('tiny'));
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.use('/', (req ,res, next) => {
    console.log(`request body:`);
    console.log(req.body);
    console.log('DATA BEFORE PROCESSING ANY REQUEST');
    console.log('Card list:');
    console.log(cardList);
    console.log('Transaction list');
    console.log(transactionList);
    console.log('>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>END')
    next()
})

// Home 
app.get('/', (req, res, next) => {
    res.send('Instructions');
})

// Global variables
let activation = false;
let totalLimit = 0;
let totalBalance = 0;
let totalSpending = 0;
let cardList = [];
let transactionList = [];

// IMPLEMENT ROUTES
// Validate data
const checkActivation = (req, res, next) => { //Validate incomming request
    if (!activation) {
        return res.status(200).send('No total limit has been set yet')
    }
    next()
}

const checkLimit = (req, res, next) => { //check if new limit request is valid
    const limit = Number(req.params.limit);
    if (limit < 5000000 || Number.isNaN(limit)) {
        return res.status(400).send('Card limit must be a number and at least VND 5,000,000')
    }
    req.limit = limit;
    next()
}

const checkLimitChangeRequest = (req, res, next) => { //Check if new limit request make the sum of all card limits exceed total limit
    const unusedLimit = updateUnusedLimit(cardList, totalLimit);
    if (unusedLimit < req.limit - req.card.limit) {
        return res.status(404).send('Unused limit not sufficient to fulfill new limit request')
    }
    next()
}

const checkUnusedLimit = (req, res, next) => { //Validate info used to create a new card
    const unusedLimit = updateUnusedLimit(cardList, totalLimit);
    if (unusedLimit < 5000000) {
        return res.status(404).send('Unused limit not sufficient to allocate to a new card')
    }
    req.unusedLimit = unusedLimit;
    next()
}

const checkNewCardRequest = (req, res, next) => { // Validate request for a new card
    if (!('limit' in req.body & 'name' in req.body)) {
        return res.status(400).send('Request body must contain limit and cardName')
    }

    const limit = Number(req.body.limit);
    const name = req.body.name.toString().trim();
    if (Number.isNaN(limit) || limit < 5000000) {
        return res.status(400).send('Proposed limit must be a number and at least VND 5,000,000')
    }
    if (name === "") {
        return res.status(400).send('The new card must have a non empty name')
    }
    if (limit > req.unusedLimit) {
        return res.status(400).send('Proposed limit exceeded available amount')
    }

    req.limit = limit;
    req.name = name;
    next()
}

const checkIfCardExists = (req, res, next) => { // Check whether card with given ID exists
    const id = req.params.id;
    const index = findCardById(cardList, id);
    if (index === false) {
        return res.status(400).send(`There is no card with ID ${id}`)
    }

    req.cardIndex = index;
    req.card = cardList[index];
    next()
}

const checkTransactionInfo = (req, res, next) => { // Validate info of new transaction to be added
    if (!('amount' in req.body & 'purpose' in req.body)) {
        return res.status(400).send('Request body must contain amount and purpose')
    }

    const amount = Number(req.body.amount);
    const purpose = req.body.purpose.toString().trim();
    if (Number.isNaN(amount)) {
        return res.status(400).send(`Amount must be a number`)
    }
    if (purpose === '') {
        return res.status(400).send('Purpose must not be empty')
    }

    const index = req.cardIndex;
    const card = req.card;
    const transactions = transactionList.filter(transaction => transaction.cardId === card.id);
    const {spending, balance} = updateBalance(transactions, card.limit);
    if (balance < amount) {
        return res.status(400).send('Transaction amount exceeds available balance. Transaction is not accepted')
    }

    next()
}

const checkIfThereAreCards = (req, res, next) => { // Check if at least one card has been issued
    if (cardList.length === 0) {
        return res.status(200).send('There is no card yet')
    }
    next()
}

const checkIfThereAreTransactions = (req, res, next) => {// Check if there are transactions already recorded
    if (transactionList.length === 0) {
        return res.status(200).send('There is no transaction yet')
    }
    next()
}

const checkDuration = (req, res, next) => {// Check if provided duration is valid
    if (!'duration' in req. body) {
        return res.status(400).send('Request body must contain duration')
    }

    const duration = Number(req.body.duration);
    if (Number.isNaN(duration) || duration <= 0) {
        return res.status(400).send('Duration must be a number greater than zero')
    }
    
    req.duration = duration;
    next()
}

// Issue total limit
app.post('/total/:limit', checkLimit, (req, res, next) => {
    if (activation) {
        return res.status(400).send('A total limit has already been set')
    }

    activation = true;
    totalLimit = req.limit;
    res.status(201).send(`Total limit of VND ${formatter.format(totalLimit)} has been set`)
})

// Get summary info
app.get('/total', checkActivation, (req, res, next) => {
    const {spending, balance} = updateBalance(transactionList, totalLimit);
    totalSpending = spending;
    totalBalance = balance;
    res.status(200).send({
        totalLimit: formatter.format(totalLimit),
        totalBalance: formatter.format(totalBalance),
        totalSpending: formatter.format(totalSpending)
    })
})

// Get all cards
app.get('/cards', checkActivation, checkIfThereAreCards, (req, res, next) => {
    const allCardsInfo = cardList.map(card => reconstructCard(card, transactionList));
    res.status(200).send(allCardsInfo)
})

// Get all transactions
app.get('/transactions', checkActivation, checkIfThereAreTransactions, (req, res, next) => {
    res.status(200).send(transactionList)
})

// Get one card
app.get('/cards/:id', checkActivation, checkIfCardExists, (req, res, next) => {
    const cardInfo = reconstructCard(req.card, transactionList);
    res.status(200).send(cardInfo)
})

// Issue new card
app.post('/cards', checkActivation, checkUnusedLimit, checkNewCardRequest, (req, res, next) => {
    const cardIdList = cardList.map(card => card.id);
    const id = issueId('CARD', cardIdList, 5);
    const limit = req.limit;
    const name = req.name;
    const card = {id, limit, name};
    cardList.push(card);
    res.status(201).send(`New card has been issued with limit of ${formatter.format(limit)} and name of ${name}`);
})

//Add a transaction
app.post('/cards/:id/transactions', checkActivation, checkIfCardExists, checkTransactionInfo, (req, res, next) => {
    const amount = req.body.amount;
    const purpose = req.body.purpose;
    const card = req.card;
    const cardId = card.id;
    const transactionIdList = transactionList.map(transaction => transaction.id);
    const transactionId = issueId('TRXN', transactionIdList, 6);
    const timestamp = new Date;
    const transaction = {transactionId, cardId, amount, timestamp, purpose};
    transactionList.push(transaction);
    res.status(201).send(`New transaction on card ${card.name} has been added. Details: ${transaction}`)
})

//Change limit of one card
app.put('/cards/:id/limit/:limit', checkActivation, checkIfCardExists, checkLimit, checkLimitChangeRequest, (req, res, next) => {
    const oldLimit = req.card.limit;
    cardList[req.cardIndex].limit = req.limit;
    res.status(201).send(`Card ${req.card.name}'s limit has been updated from ${formatter.format(oldLimit)} to ${formatter.format(req.limit)}`)
})

//Rename one card
app.put('/cards/:id', checkActivation, checkIfCardExists, (req, res, next) => {
    if (!('name' in req.body)) {
        return res.status(400).send('Request body must contain name')
    }
    const newName = req.body.name.toString().trim();
    if (newName === "") {
        return res.status(400).send('Name must not be empty')
    }
    
    const oldName = cardList[req.cardIndex].name;
    cardList[req.cardIndex].name = newName;
    res.status(400).send(`Card ${oldName} has been renamed to ${newName}`)   
})

//Delete all cards
app.delete('/cards', checkActivation, (req, res, next) => {
    cardList.splice(0, cardList.length);
    totalBalance = 0;
    totalSpending = 0;
    res.status(200).send(`All cards and transactions has been deleted but total limit remains ${formatter.format(totalLimit)}. 
    Total balance is set to ${formatter.format(totalBalance)}.
    Total spending is set to ${formatter.format(totalSpending)}`)
})

//Delete all transactions within a time frame
app.delete('/transactions/', checkActivation, checkIfThereAreTransactions, checkDuration, (req, res, next) => {
    const currentTime = new Date;
    const duration = req.duration;
    transactionList = transactionList.filter(transaction => checkTimeGap(transaction, currentTime, duration));
    res.status(200).send(`All transactions created within ${duration} minute(s) have been deleted`)
})

// Final step
const port = 3000;
app.listen(port, () => {
    console.log(`Listening at port ${port}`)
})