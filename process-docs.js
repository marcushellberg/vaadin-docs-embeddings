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

async function createAndSaveEmbeddings(blocks, path, namespace) {

  // OpenAI suggests removing newlines for better performance when creating embeddings.
  // Don't remove them from the source.
  const withoutNewlines = blocks.map(block => block.replace(/\n/g, ' '));
  const embeddings = await getEmbeddings(withoutNewlines);
  const vectors = embeddings.map((embedding, i) => ({
    id: nanoid(),
    values: embedding,
    metadata: {
      path: path,
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
async function processAdoc(file, path) {
  console.log(`Processing ${path}`);

  const frontMatterRegex = /^---[\s\S]+?---\n*/;

  // Extract the namespace (framework) from the path
  const namespace = path.includes('articles/react') ? 'react' : path.includes('articles/lit') ? 'lit' : '';
  if (!namespace) return;

  // Remove front matter. The JS version of asciidoctor doesn't support removing it.
  const noFrontMatter = file.replace(frontMatterRegex, '');

  // Run through asciidoctor to get includes
  const html = asciidoctor.convert(noFrontMatter, {
    attributes: {
      root: process.env.DOCS_ROOT,
      articles: process.env.DOCS_ARTICLES,
      react: namespace === 'react',
      lit: namespace === 'lit'
    },
    safe: 'unsafe',
    base_dir: process.env.DOCS_ARTICLES
  });

  // Extract sections
  const dom = new JSDOM(html);
  const sections = dom.window.document.querySelectorAll('.sect1');

  // Convert section html to plain text to save on tokens
  const plainText = Array.from(sections).map(section => convert(section.innerHTML));

  // Split section content further if needed, filter out short blocks
  const docs = await splitter.createDocuments(plainText);
  const blocks = docs.map(doc => doc.pageContent)
    .filter(block => block.length > 200);

  await createAndSaveEmbeddings(blocks, path, namespace);
}

// create analysis.json by running `npm run analyze` in
// https://github.com/vaadin/web-components
async function processElementDocs(file, path) {
  if(!path.includes('analysis.json')) return;
  console.log(`Processing ${path}`);
  const json = JSON.parse(file);
  const descriptions = json.elements.map(element => element.description);
  const docs = await splitter.createDocuments(descriptions);
  const blocks = docs.map(doc => doc.pageContent);

  await createAndSaveEmbeddings(blocks, path, 'lit');
}

async function processPath(inputPath) {
  try {
    const stats = await fs.stat(inputPath);

    if (stats.isDirectory()) {
      const files = await fs.readdir(inputPath);

      for (const file of files) {
        const fullPath = path.join(inputPath, file);
        await processPath(fullPath);
      }
    } else if (stats.isFile()) {
      const data = await fs.readFile(inputPath, 'utf8');
      if (['.adoc', '.asciidoc'].includes(path.extname(inputPath))) {
        await processAdoc(data, inputPath);
      } else if (path.extname(inputPath) === '.json') {
        await processElementDocs(data, inputPath);
      }
    }
  } catch (err) {
    console.error(`Error reading file/directory: ${err}`);
  }
}

async function processDocs(directories) {
  console.log('Processing docs...');
  await Promise.all(directories.map(processPath));
  console.log('Done.');
}

await processDocs([
  process.env.DOCS_ARTICLES,
  process.env.COMPONENT_DOCS
]);