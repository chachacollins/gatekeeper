import path, {join} from 'path';
import multer from 'multer';
import { thoughtsQuery, thoughtsRemember } from './llm.ts';
import { Command } from 'commander'
import { readFileSync } from 'fs';
import express from 'express';
import ora from 'ora';
import chalk from 'chalk';
import figlet from 'figlet';

async function askLLM(query: string): string {
    let spinner = ora('Searching knowledge base...').start();
    try {
        const retriever = await thoughtsQuery({ query });
        spinner.succeed('Answer retrieved!');
        return retriever.answer; 
    } catch (error) {
        spinner.fail('Failed to retrieve answer.');
        throw new Error(error);
    }
}

async function remindLLM(data: string) {
    const fileExtensions = ['.pdf', '.txt', '.doc', '.docx', '.md', '.json'];
    const hasKnownExtension = fileExtensions.some(ext =>
        data.toLowerCase().endsWith(ext)
    );
    let indexer;
    const spinner = ora('Indexing content into knowledge base...\n').start();
    try {
        if (hasKnownExtension) {
            indexer = await thoughtsRemember({
                type: 'file',
                filePath: data
            });
        } else {
            indexer = await thoughtsRemember({
                type: 'text',
                data: data
            });
        }
        spinner.succeed(`Indexed ${indexer.documentsIndexed} chunks successfully.`);
    } catch (error) {
        spinner.fail('Failed to index content.');
        throw new Error(error);
    }
}

const app = express();

app.use(express.json());
app.use(express.text());

app.post('/ask', async (req, res) => {
    const query = req.body.query;
    try {
        const answer = await askLLM(query);
        res.json({ answer: answer , success: true});
        console.log(answer);
    } catch(error) {
        res.json({ answer: error , success: false});
    }
})

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/')
    },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname);
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + ext);
    }
});

const upload = multer({ storage: storage});

app.post('/remember', upload.single('file'), async (req, res) => {
    const contentType = req.get('Content-Type');
    if(contentType == 'text/plain') {
        try {
            await remindLLM(req.body);
            res.json({ answer: "data indexed" , success: true});
        }catch (error) {
            res.json({ answer: error , success: true});
        }
    } else {
        try {
            await remindLLM(req.file.path);
            res.json({ answer: "file indexed" , success: true});
        }catch (error) {
            res.json({ answer: error , success: true});
        }
    }
})


//TODO: support more file types
//TODO: add server


async function main() {
    const fontData = readFileSync(join(__dirname, 'fonts', 'ansi_shadow.flf'), 'utf8');
    figlet.parseFont('ANSI Shadow', fontData);
    let headerColor = chalk.hex('#da7757');
    let textColor = chalk.hex('#ebdbb2');
    console.log(headerColor(figlet.textSync('GateKeeper', { font: 'ANSI Shadow' })));
    const program = new Command();
    program
        .version('1.0.0')
        .description('A RAG for your own personal knowledge base')
        .option('-a, --ask [query]', 'Query the RAG for info')
        .option('-r, --remember [content]', 'Add content to the RAG model to be queried later')
        .option('-s, --serve [port]', 'Start a server running on the specified port or 6969 by default')
        .parse(process.argv);
    const options = program.opts();
    if (options.ask) {
        let query = typeof options.ask === 'string' ? options.ask : "What do I do for fun?";
        try {
            let answer = await askLLM(query);
            console.log(textColor(answer));
        } catch (error) {
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
        try {
            await remindLLM(data);
        } catch (error) {
            console.error(error);
        }
    }
    if (options.serve) {
        let port = typeof options.serve === 'number' ? options.serve : 6969;
        app.listen(port, () => {
            console.log(`App running on port ${port}`);
        })
    }
}

main().catch(console.error);
