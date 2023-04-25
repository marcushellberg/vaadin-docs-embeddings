import * as dotenv from 'dotenv';
dotenv.config();
import { PineconeClient } from '@pinecone-database/pinecone';

const pinecone = new PineconeClient();
await pinecone.init({
  apiKey: process.env.PINECONE_API_KEY,
  environment: process.env.PINECONE_ENVIRONMENT,
});

export async function getOrCreatePineconeIndex() {
  if(!(await pinecone.listIndexes()).includes(process.env.PINECONE_INDEX)) {
    console.log(`Creating index ${process.env.PINECONE_INDEX}`);
    await pinecone.createIndex({
      createRequest: {
        name: process.env.PINECONE_INDEX,
        dimension: 1536,
        metadataConfig: {
          indexed: ["path"]
        }
      },
    });
  }
  return pinecone.Index(process.env.PINECONE_INDEX);
}
