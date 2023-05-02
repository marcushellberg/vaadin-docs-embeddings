import * as dotenv from 'dotenv';
import { Configuration, OpenAIApi } from 'openai';

dotenv.config();

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY
});

const openai = new OpenAIApi(configuration);

export async function getEmbeddings(texts) {
  const response = await openai.createEmbedding({
    model: 'text-embedding-ada-002',
    input: texts
  });
  return response.data.data.map((item) => item.embedding);
}