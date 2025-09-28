import { googleAI } from '@genkit-ai/google-genai';
import { join } from 'path';
import { z, genkit } from 'genkit';
import { pinecone } from 'genkitx-pinecone';
import { pineconeRetrieverRef } from 'genkitx-pinecone';
import { pineconeIndexerRef } from 'genkitx-pinecone';
import { Document } from 'genkit/retriever';
import { chunk } from 'llm-chunk';
import { readFile } from 'fs/promises';
import{ readFileSync } from 'fs';
import { Command } from 'commander'
import ora from 'ora';
import chalk from 'chalk';
import figlet from 'figlet';
import path from 'path';
import { remark } from 'remark';
import strip from 'strip-markdown'
import pdf from 'pdf-parse';


//TODO: support more file types
//TODO: add server

const ai = genkit({
    plugins: [
        googleAI(),
        pinecone([
            {
                indexId: 'thoughts',
                embedder: googleAI.embedder('gemini-embedding-001'),
            },
        ]),
    ],
});


export const thoughtsIndexer = pineconeIndexerRef({
  indexId: 'thoughts',
});

const chunkingConfig = {
    minLength: 1000,
    maxLength: 2000,
    splitter: 'sentence',
    overlap: 100,
    delimiters: '',
} as any;

type ExtractorFn = (filePath: string) => Promise<string>;

export async function extractTextFromMd(filePath: string) {
    const absolutePath = path.resolve(filePath);
    const markdownContent = await readFile(absolutePath, 'utf8');
    const processed = await remark()
        .use(strip, { keep: ['heading', 'list', 'code'] })
        .process(markdownContent);
    return String(processed)
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

async function extractTextFromPdf(filePath: string) {
    const pdfFile = path.resolve(filePath);
    const dataBuffer = await readFile(pdfFile);
    const data = await pdf(dataBuffer);
    return data.text;
}

const extractors: Record<string, ExtractorFn> = {
    '.pdf': extractTextFromPdf,
    '.md': extractTextFromMd,
};

async function extractTextFromFile(filePath: string): Promise<string> {
    const ext = path.extname(filePath).toLowerCase();
    const extractor = extractors[ext];

    if (!extractor) {
        throw new Error(`Unsupported file type: ${ext}`);
    }

    return extractor(filePath);
}

const indexThoughtsSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('file'),
        filePath: z.string().describe('PDF file path'),
    }),
    z.object({
        type: z.literal('text'),
        data: z.string().describe('raw text to be fed into the rag'),
    })
]);

export const indexThoughts = ai.defineFlow(
    {
        name: 'indexThoughts',
        inputSchema: indexThoughtsSchema,
        outputSchema: z.object({
            success: z.boolean(),
            documentsIndexed: z.number(),
            error: z.string().optional(),
        }),
    },
    async (input) => {
        try {
            let textContent: string;
            let sourceFilePath: string;

            if (input.type === 'file') {
                sourceFilePath = path.resolve(input.filePath);
                textContent = await ai.run('extract-text', () => extractTextFromFile(sourceFilePath));
            } else {
                textContent = input.data;
                sourceFilePath = 'raw-text-input';
            }

            const chunks = await ai.run('chunk-it', async () => chunk(textContent, chunkingConfig));
            const documents = chunks.map((text) => {
                return Document.fromText(text, { filePath: sourceFilePath });
            });

            await ai.index({
                indexer: thoughtsIndexer,
                documents,
            });

            return {
                success: true,
                documentsIndexed: documents.length,
            };
        } catch (err) {
            return {
                success: false,
                documentsIndexed: 0,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    },
);

export const thoughtsRetriever = pineconeRetrieverRef({
    indexId: 'thoughts',
});

export const thoughtsFlow = ai.defineFlow(
    {
        name: 'thoughts',
        inputSchema: z.object({ query: z.string() }),
        outputSchema: z.object({ answer: z.string() }),
    },
    async ({ query }) => {
        const docs = await ai.retrieve({
            retriever: thoughtsRetriever,
            query,
            options: { k: 3 },
        });
        const { text } = await ai.generate({
            model: googleAI.model('gemini-2.5-flash'),
            prompt: `
You are acting as a helpful AI assistant that can answer
questions about whatever the user asks 

Use only the context provided to answer the question.
If you don't know, do not make up an answer.

Question: ${query}`,
            docs,
        });

        return { answer: text };
    },
);

async function main() {
    const fontData = readFileSync(join(__dirname, 'fonts', 'ansi_shadow.flf'), 'utf8');
    figlet.parseFont('ANSI Shadow', fontData);
    let headerColor = chalk.hex('#da7757');
    let textColor = chalk.hex('#ebdbb2');
    console.log(headerColor(figlet.textSync('GateKeeper', {font: 'ANSI Shadow'})));
    const program = new Command();
    program
        .version('1.0.0')
        .description('A RAG for your own personal knowledge base')
        .option('-a, --ask [query]', 'Query the RAG for info')
        .option('-r, --remember [content]', 'Add content to the RAG model to be queried later')
        .parse(process.argv);
    const options = program.opts();
    if (options.ask) {
        let query = typeof options.ask === 'string' ? options.ask : "What do I do for fun?";
        let spinner = ora('Searching knowledge base...').start();
        try {
            const retriever = await thoughtsFlow({query});
            spinner.succeed('Answer retrieved!');
            console.log(textColor(retriever.answer));
        } catch(error) {
            spinner.fail('Failed to retrieve answer.');
            console.error(error);
        }
    }
    if (options.remember) {
        let data = typeof options.remember === 'string' 
            ? options.remember 
            : (() => { 
                console.error(chalk.red("Please provide the data to be remembered after the remember command")); 
                process.exit(1);
            })();;

        const fileExtensions = ['.pdf', '.txt', '.doc', '.docx', '.md', '.json'];
        const hasKnownExtension = fileExtensions.some(ext => 
            data.toLowerCase().endsWith(ext)
        );
        let indexer;
        const spinner = ora('Indexing content into knowledge base...\n').start();
        try {
            if (hasKnownExtension) {
                indexer = await indexThoughts({
                    type: 'file',
                    filePath: data
                });
            } else {
                indexer = await indexThoughts({
                    type: 'text',
                    data: data
                });
            }
            spinner.succeed(`Indexed ${indexer.documentsIndexed} chunks successfully.`);
        } catch(error) {
            spinner.fail('Failed to index content.');
            console.error(error);
        }
    }
}

main().catch(console.error);
