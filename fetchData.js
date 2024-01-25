import mongoose from 'mongoose';
import { config, sleep, Transaction, Evmlog, Status, getLastBlockNumber, getBlockByNumber, getEvmLogs, getStatusId } from './global.js';

const inputPrefix = '0x646174613a';
const topicTransfer = '0x8cdf9e10a7b20e7a9c4e778fc3eb28f2766e438a9856a62eac39fbd2be98cbc2';
const topicExchange = '0xe2750d6418e3719830794d3db788aa72febcd657bcd18ed8f1facdbf61a69a9a';

let fetchBlockNumber = 0;
let lastBlockNumber = 0;

let statusId = '';

export async function fetchData() {
    const start = Date.now();

    if (statusId == '') {
        statusId = await getStatusId();
    }

    // get last block number
    if (lastBlockNumber == 0) {
        lastBlockNumber = await getLastBlockNumber();
    }

    try {
        if (fetchBlockNumber == 0) {
            const statusRow = await Status.findOne({});
            fetchBlockNumber = statusRow.block;

            if (fetchBlockNumber == 0) {
                fetchBlockNumber = parseInt(config.FROM_LOG_BLOCK || '0');
                console.log('no records found in the databse, start from', fetchBlockNumber);
            } else {
                console.log('start with the latest block in the database', fetchBlockNumber);
            }
        }

        fetchBlockNumber++;
        if (fetchBlockNumber > lastBlockNumber) {
            lastBlockNumber = await getLastBlockNumber();
            if (fetchBlockNumber > lastBlockNumber) {
                throw new Error('block readed');
            }
        }
        console.log('fetch at block:', fetchBlockNumber, 'newest:', lastBlockNumber);

        // save time by launching two requests at the same time
        const result = await new Promise((resolve, reject) => {
            const result = { 
                transactions: [],
                evmLogs: [],
                timestamp: 0,
                count: 0,
            };
            getBlockByNumber(fetchBlockNumber).then(block => {
                result.timestamp = parseInt(block.timestamp);
                if (block.transactions && block.transactions.length > 0) {
                    for (const transaction of block.transactions) {
                        if (transaction.input.startsWith(inputPrefix)) {
                            result.transactions.push({
                                id:        transaction.hash,
                                from:      transaction.from,
                                to:        transaction.to,
                                block:     parseInt(transaction.blockNumber),
                                idx:       parseInt(transaction.transactionIndex),
                                timestamp: result.timestamp,
                                input:     transaction.input
                            });
                        }
                    }
                }
                if (++result.count == 2) {
                    resolve(result);
                }
            })
            .catch(reject);

            getEvmLogs(fetchBlockNumber, fetchBlockNumber).then(txLogs => {
                if (txLogs && txLogs.length > 0) {
                    for (const tx of txLogs) {
                        if  (tx.topics && (tx.topics[0] == topicTransfer || tx.topics[0] == topicExchange)) {
                            result.evmLogs.push({
                                hash:      tx.transactionHash,
                                address:   tx.address,
                                topics:    tx.topics,
                                data:      tx.data,
                                block:     parseInt(tx.blockNumber),
                                trxIndex:  parseInt(tx.transactionIndex),
                                logIndex:  parseInt(tx.logIndex),
                                timestamp: 0
                            });
                        }
                    }
                }
                if (++result.count == 2) {
                    resolve(result);
                }
            })
            .catch(reject);
        });
        
        // save to db
        let session = null;
        try {
            session = await mongoose.startSession();
            session.startTransaction();
            if (result.transactions.length > 0) {
                await Transaction.insertMany(result.transactions, { session });
            }
            if (result.evmLogs.length > 0) {
                for (const evmLog of result.evmLogs) {
                    evmLog.timestamp = result.timestamp;
                }
                await Evmlog.insertMany(result.evmLogs, { session });
            }
            await Status.updateOne({_id: statusId}, {block: fetchBlockNumber}, { session });

            await session.commitTransaction();
            await session.endSession();
        } catch (e) {
            // console.log(e);
            if (session) {
                await session.abortTransaction();
                await session.endSession();
            }
            throw e;
        }

        console.log('fetch completed,', result.transactions.length, 'trxs,', result.evmLogs.length, 'logs, cost time:', Date.now() - start,  'ms');

    } catch (error) {
        fetchBlockNumber--;
        console.error('fetch error', error.message);
        await sleep(2000);
    } finally {
        fetchData();
    }

}



