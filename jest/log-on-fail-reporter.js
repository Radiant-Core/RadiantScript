const chalk = require('chalk');
const { DefaultReporter } = require('@jest/reporters');

const TITLE_BULLET = chalk.bold('\u25cf ');

// This Jest reporter does not output any console.log except when the tests are
// failing, see: https://github.com/mozilla/addons-frontend/issues/2980.
class LogOnFailReporter extends DefaultReporter {
  printTestFileHeader(_testPath, config, result) {
    const testFailed = result.numFailingTests > 0;
    const consoleBuffer = result.console;

    if (testFailed) {
      super.printTestFileHeader(_testPath, config, result);
      
      if (consoleBuffer && consoleBuffer.length) {
        this.log(`  ${TITLE_BULLET}Console\n`);
        consoleBuffer.forEach((log) => {
          this.log(`    ${log.message}`);
        });
      }
    }
  }
}

module.exports = LogOnFailReporter;
