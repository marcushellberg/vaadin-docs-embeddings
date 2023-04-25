import * as dotenv from 'dotenv';
dotenv.config();
import { codeBlock, oneLine } from 'common-tags';
import { Configuration, OpenAIApi } from 'openai';

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
