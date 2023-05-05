import fs from 'fs/promises';
import path from 'path';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { getEmbeddings } from './openai.js';
import { nanoid } from 'nanoid';
import { getOrCreatePineconeIndex } from './pinecone.js';
import { convert } from 'html-to-text';
import Processor from 'asciidoctor';
import { JSDOM } from 'jsdom';

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 2000,
  chunkOverlap: 100
});

const pinecone = await getOrCreatePineconeIndex();

const asciidoctor = new Processor();

async function createAndSaveEmbeddings(blocks, filePath, namespace) {
  // OpenAI suggests removing newlines for better performance when creating embeddings.
  // Don't remove them from the source.
  const withoutNewlines = blocks.map(block => block.replace(/\n/g, ' '));
  const embeddings = await getEmbeddings(withoutNewlines);

  const vectors = embeddings.map((embedding, i) => ({
    id: nanoid(),
    values: embedding,
    metadata: {
      path: filePath,
      text: blocks[i]
    }
  }));

  await pinecone.upsert({
    upsertRequest: {
      vectors,
      namespace
    }
  });
}

// Docs can be checked out here https://github.com/vaadin/docs/tree/hilla/articles
async function processAdoc(file, filePath, namespace) {
  // Extract the namespace (framework) from the filePath
  namespace += filePath.includes('articles/react') ? '-react' : filePath.includes('articles/lit') ? '-lit' : '';
  if(namespace === 'hilla') return; // don't include the 404 and index page in the root
  console.log(`Processing ${filePath} in namespace "${namespace}"...`);

  const frontMatterRegex = /^---[\s\S]+?---\n*/;

  // Remove front matter. The JS version of asciidoctor doesn't support removing it.
  let content = file.replace(frontMatterRegex, '');

  // Remove typescript source blocks from flow components docs
  if(namespace === 'flow') {
    content = content.replace(/\[source,\s?typescript\]\n----[\s\S]*?----/gs, '');
  }

  // Run through asciidoctor to get includes
  const html = asciidoctor.convert(content, {
    attributes: {
      root: process.env.DOCS_ROOT,
      articles: process.env.DOCS_ARTICLES,
      react: namespace === 'hilla-react',
      lit: namespace === 'hilla-lit',
      flow: namespace === 'flow'
    },
    safe: 'unsafe',
    base_dir: path.dirname(filePath)
  });

  // Split content, filter out short blocks
  const docs = await splitter.createDocuments([convert(html)]);
  const blocks = docs.map(doc => doc.pageContent)
    .filter(block => block.length > 100);

  // DEBUG:
  // console.log(blocks.join('\n\n---\n\n'));

  if(blocks.length === 0) {
    // No sections, no document, bail out
    console.log(`No sections for ${filePath}`)
    console.log(file);
    return;
  }

  await createAndSaveEmbeddings(blocks, filePath, namespace);
}

// create analysis.json by running `npm run analyze` in
// https://github.com/vaadin/web-components
async function processElementDocs(file, path, namespace) {
  if(!path.includes('analysis.json')) return;
  namespace += '-lit'; // we only have this for lit
  console.log(`Processing ${path} in namespace "${namespace}"...`);

  const json = JSON.parse(file);
  const descriptions = json.elements.map(element => element.description);
  const docs = await splitter.createDocuments(descriptions);
  const blocks = docs.map(doc => doc.pageContent);

  await createAndSaveEmbeddings(blocks, path, namespace);
}

async function processPath(inputPath, namespace) {
  try {
    const stats = await fs.stat(inputPath);

    if (stats.isDirectory()) {
      const files = await fs.readdir(inputPath);

      for (const file of files) {
        const fullPath = path.join(inputPath, file);
        await processPath(fullPath, namespace);
      }
    } else if (stats.isFile()) {
      if (path.basename(inputPath).startsWith('_')) return;
      const data = await fs.readFile(inputPath, 'utf8');
      if (['.adoc', '.asciidoc'].includes(path.extname(inputPath))) {
        await processAdoc(data, inputPath, namespace);
      } else if (path.extname(inputPath) === '.json') {
        await processElementDocs(data, inputPath, namespace);
      }
    }
  } catch (err) {
    console.error(`Error reading file/directory: ${err}`);
  }
}

async function processDocs(directories, namespace){
  console.log('Processing docs...');
  await Promise.all(directories.map(directory => processPath(directory, namespace)));
  console.log('Done.');
}

// Uses hilla branch of docs repo
await processDocs([process.env.DOCS_ARTICLES, process.env.COMPONENT_DOCS], 'hilla');

// Uses latest branch of docs repo
// await processDocs([process.env.DOCS_ARTICLES], 'flow');