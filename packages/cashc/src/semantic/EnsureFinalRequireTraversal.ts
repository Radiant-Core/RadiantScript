import {
  ContractNode,
  ParameterNode,
  FunctionDefinitionNode,
  RequireNode,
  StatementNode,
  TimeOpNode,
  BranchNode,
} from '../ast/AST.js';
import AstTraversal from '../ast/AstTraversal.js';
import { EmptyContractError, EmptyFunctionError, FinalRequireStatementError } from '../Errors.js';

export default class EnsureFinalRequireTraversal extends AstTraversal {
  visitContract(node: ContractNode): ContractNode {
    node.parameters = this.visitList(node.parameters) as ParameterNode[];
    node.functionParameters = this.visitList(node.functionParameters) as ParameterNode[];
    node.functions = this.visitList(node.functions) as FunctionDefinitionNode[];

    if (node.functions.length === 0 && node.statements.length === 0) {
      throw new EmptyContractError(node);
    }

    if (node.functions.length === 0) {
      ensureFinalStatementIsRequire(node.statements);
    }

    return node;
  }

  visitFunctionDefinition(node: FunctionDefinitionNode): FunctionDefinitionNode {
    node.parameters = this.visitList(node.parameters) as ParameterNode[];
    node.body = this.visit(node.body);

    if (node.body.statements === undefined || node.body.statements.length === 0) {
      throw new EmptyFunctionError(node);
    }

    ensureFinalStatementIsRequire(node.body.statements);

    return node;
  }
}

function ensureFinalStatementIsRequire(statements: StatementNode[] = []): void {
  const finalStatement = statements[statements.length - 1];

  if (!finalStatement) return;

  // If the final statement is a branch node, then both branches need to end with a require().
  // A terminal branch without an else block is rejected: the implicit (missing) else path
  // would otherwise spend unconditionally, since codegen appends OP_1 after OP_ENDIF.
  if (finalStatement instanceof BranchNode) {
    if (!finalStatement.elseBlock) {
      throw new FinalRequireStatementError(finalStatement);
    }
    ensureFinalStatementIsRequire(finalStatement.ifBlock.statements);
    ensureFinalStatementIsRequire(finalStatement.elseBlock.statements);
    return;
  }

  // The final statement needs to be a require()
  if (!(finalStatement instanceof RequireNode || finalStatement instanceof TimeOpNode)) {
    throw new FinalRequireStatementError(finalStatement);
  }
}
