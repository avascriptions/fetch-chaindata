import { connectMongo } from './global.js';
import { fetchData } from './fetchData.js';

async function main() {

    await connectMongo();

    fetchData();

}

main();