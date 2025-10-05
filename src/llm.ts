import { googleAI } from '@genkit-ai/google-genai';
import path, {join} from 'path';
import { z, genkit } from 'genkit';
import { pinecone } from 'genkitx-pinecone';
import { pineconeRetrieverRef } from 'genkitx-pinecone';
import { pineconeIndexerRef } from 'genkitx-pinecone';
import { Document } from 'genkit/retriever';
import { chunk } from 'llm-chunk';
import { readFile } from 'fs/promises';
import { remark } from 'remark';
import strip from 'strip-markdown'
import pdf from 'pdf-parse';

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

const thoughtsRememberSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('file'),
        filePath: z.string().describe('PDF file path'),
    }),
    z.object({
        type: z.literal('text'),
        data: z.string().describe('raw text to be fed into the rag'),
    })
]);

export const thoughtsRemember = ai.defineFlow(
    {
        name: 'thoughtsRemember',
        inputSchema: thoughtsRememberSchema,
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

export const thoughtsQuery = ai.defineFlow(
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
I will ask you a question and will provide some additional context information.
Assume this context information is factual and correct, as part of internal
documentation.
If the question relates to the context, answer it using the context.
If the question does not relate to the context, answer it as normal.

For example, let's say the context has nothing in it about tropical flowers;
then if I ask you about tropical flowers, just answer what you know about them
without referring to the context.

For example, if the context does mention minerology and I ask you about that,
provide information from the context along with general knowledge.

Question: ${query}`,
            docs,
        });

        return { answer: text };
    },
);
