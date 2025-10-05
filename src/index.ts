import { join, path } from 'path';
import { thoughtsQuery, thoughtsRemember } from './llm.ts';
import { Command } from 'commander'
import { readFileSync } from 'fs';
import ora from 'ora';
import chalk from 'chalk';
import figlet from 'figlet';


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
        .parse(process.argv);
    const options = program.opts();
    if (options.ask) {
        let query = typeof options.ask === 'string' ? options.ask : "What do I do for fun?";
        let spinner = ora('Searching knowledge base...').start();
        try {
            const retriever = await thoughtsQuery({ query });
            spinner.succeed('Answer retrieved!');
            console.log(textColor(retriever.answer));
        } catch (error) {
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
            console.error(error);
        }
    }
}

main().catch(console.error);
