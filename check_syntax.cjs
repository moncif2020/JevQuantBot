const fs = require('fs');
const content = fs.readFileSync('src/App.tsx', 'utf8');

// Use typescript parser
const ts = require('typescript');
const sourceFile = ts.createSourceFile('test.tsx', content, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
function checkNode(node) {
  ts.forEachChild(node, checkNode);
}
checkNode(sourceFile);
console.log('Parse diagnostics count:', sourceFile.parseDiagnostics ? sourceFile.parseDiagnostics.length : 0);
if (sourceFile.parseDiagnostics) {
  for (const d of sourceFile.parseDiagnostics) {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(d.start);
    console.log(`Line ${line + 1}:${character + 1} - ${d.messageText}`);
  }
}
