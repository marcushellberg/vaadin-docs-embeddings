import fs from 'fs/promises';
import path from 'path';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { getEmbeddings } from './openai.js';
import { nanoid } from 'nanoid';
import { getOrCreatePineconeIndex } from './pinecone.js';
import { convert } from 'html-to-text';

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 2000,
  chunkOverlap: 100
});

const pinecone = await getOrCreatePineconeIndex();

async function createAndSaveEmbeddings(blocks, path) {

  const embeddings = await getEmbeddings(blocks);
  const vectors = embeddings.map((embedding, i) => ({
    id: nanoid(),
    values: embedding,
    metadata: {
      path: path,
      text: blocks[i]
    }
  }));

  await pinecone.upsert({ upsertRequest: { vectors } });
}

// Asciidoc files are created in the docs directory with asciidoctor.
// The following command is used to create the files for Hilla+Lit:
// asciidoctor -D html -a lit=true -a root=/Users/mhellber/dev/docs/docs -a articles=/Users/mhellber/dev/docs/docs/articles '**/*.adoc' '**/*.asciidoc'
async function processAdoc(file, path) {
  console.log(`Processing ${path}`);
  // Convert html to plain text to save on tokens
  const plainText = convert(file);
  const docs = await splitter.createDocuments([plainText]);
  const blocks = docs.map(doc => doc.pageContent);

  await createAndSaveEmbeddings(blocks, path);
}

// create analysis.json by running `npm run analyze` in https://github.com/vaadin/web-components
async function processElementDocs(file, path) {
  console.log(`Processing ${path}`);
  const json = JSON.parse(file);
  const descriptions = json.elements.map(element => element.description);
  const docs = await splitter.createDocuments(descriptions);
  const blocks = docs.map(doc => doc.pageContent);

  await createAndSaveEmbeddings(blocks, path);
}

async function processDirectory(directory) {
  try {
    const files = await fs.readdir(directory);

    for (const file of files) {
      const fullPath = path.join(directory, file);
      const stats = await fs.stat(fullPath);

      if (stats.isDirectory()) {
        await processDirectory(fullPath);
      } else if (stats.isFile()) {
        const data = await fs.readFile(fullPath, 'utf8');
        if (path.extname(file) === '.html') {
          await processAdoc(data, fullPath);
        } else if (path.extname(file) === '.json') {
          await processElementDocs(data, fullPath);
        }
      }
    }
  } catch
    (err) {
    console.error(`Error reading file/directory: ${err}`);
  }
}

async function processDocs() {
  console.log('Processing docs...');
  await processDirectory('./docs');
  console.log('Done.');
}

processDocs();