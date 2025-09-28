# Gatekeeper

## How to build
- Because the JS ecosystem sucks building this is complicated.
- Ensure that you have both bun and node installed(yes really I'm not even trying to be funny).
- Run 
```bash
    npm install
```
- Then you want to delete the tests that come with pdf parser
```bash
   rm -rf node_modules/pdf-parse/test/
```
- Then delete the debug line in pdf-parse/index.js
- You can now use bun to create an 'executable'

```
    bun build --compile ./src/index.ts --outfile gatekeeper
```
- You can then add this to your path. 

[!WARNING]
>DO NOT DELETE THIS REPOSITORY EVEN AFTER YOU HAVE BUILT THIS APP
