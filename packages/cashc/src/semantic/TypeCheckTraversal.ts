import {
  PrimitiveType,
  explicitlyCastable,
  implicitlyCastable,
  implicitlyCastableSignature,
  resultingType,
  arrayType,
  ArrayType,
  TupleType,
  BytesType,
  Type,
} from '@radiantscript/utils';
import {
  AssignNode,
  BranchNode,
  CastNode,
  FunctionCallNode,
  UnaryOpNode,
  BinaryOpNode,
  IdentifierNode,
  TimeOpNode,
  VariableDefinitionNode,
  ArrayNode,
  TupleIndexOpNode,
  RequireNode,
  Node,
  InstantiationNode,
  TupleAssignmentNode,
  NullaryOpNode,
  PushDataNode,
  PushRefNode,
  ParameterNode,
  HexLiteralNode,
  IntLiteralNode,
} from '../ast/AST.js';
import AstTraversal from '../ast/AstTraversal.js';
import {
  InvalidParameterTypeError,
  UnequalTypeError,
  UnsupportedTypeError,
  CastTypeError,
  TypeError,
  AssignTypeError,
  ArrayElementError,
  IndexOutOfBoundsError,
  CastSizeError,
  TupleAssignmentError,
  PushTypeError,
  UnsupportedOperatorError,
} from '../Errors.js';
import { BinaryOperator, NullaryOperator, UnaryOperator } from '../ast/Operator.js';
import { GlobalFunction, Modifier } from '../ast/Globals.js';

export default class TypeCheckTraversal extends AstTraversal {
  visitVariableDefinition(node: VariableDefinitionNode): Node {
    node.expression = this.visit(node.expression);
    expectAssignable(node, node.expression.type, node.type);
    return node;
  }

  visitTupleAssignment(node: TupleAssignmentNode): Node {
    node.tuple = this.visit(node.tuple);
    if (!(node.tuple instanceof BinaryOpNode) || node.tuple.operator !== BinaryOperator.SPLIT) {
      throw new TupleAssignmentError(node.tuple);
    }
    const tupleType = node.tuple.left.type;
    const splitIndex = node.tuple.right;

    // When the source is bounded bytes and the split index is a constant, we can
    // compute the exact width of each half: var1 = `index` bytes, var2 = the
    // remaining `bound - index` bytes. A declared bound that disagrees with the
    // computed width is a lie about the value's size and must be rejected.
    const sourceBound = tupleType instanceof BytesType ? tupleType.bound : undefined;
    const constIndex = splitIndex instanceof IntLiteralNode ? Number(splitIndex.value) : undefined;
    const expectedBounds = sourceBound !== undefined && constIndex !== undefined
      ? [constIndex, sourceBound - constIndex]
      : [undefined, undefined];

    for (const [i, variable] of [node.var1, node.var2].entries()) {
      // When both sides are bytes and the half-width is statically known, the
      // declared bound must match that width exactly. This runs even when
      // `implicitlyCastable` accepts the assignment (e.g. bytes32 -> bytes32),
      // because the source bound is the whole width, not this half's width — the
      // escape hatch below would otherwise let a wrong declared bound through.
      if (tupleType instanceof BytesType && variable.type instanceof BytesType) {
        const expected = expectedBounds[i];
        if (
          expected !== undefined
          && variable.type.bound !== undefined
          && variable.type.bound !== expected
        ) {
          throw new AssignTypeError(
            new VariableDefinitionNode(variable.type, '', variable.name, node.tuple),
          );
        }
      }

      if (!implicitlyCastable(tupleType, variable.type)) {
        // Ignore if both are of type bytes. The half-widths could not be verified
        // statically here (unbounded source or non-constant split index), so the
        // declared bound is allowed but remains unchecked. problem: bytes16 can be
        // typed to bytes32
        if (tupleType instanceof BytesType && variable.type instanceof BytesType) {
          continue;
        }
        throw new AssignTypeError(
          new VariableDefinitionNode(variable.type, '', variable.name, node.tuple),
        );
      }
    }
    return node;
  }

  visitAssign(node: AssignNode): Node {
    node.identifier = this.visit(node.identifier) as IdentifierNode;
    node.expression = this.visit(node.expression);
    expectAssignable(node, node.expression.type, node.identifier.type);
    return node;
  }

  visitTimeOp(node: TimeOpNode): Node {
    node.expression = this.visit(node.expression);
    expectInt(node, node.expression.type);
    return node;
  }

  visitRequire(node: RequireNode): Node {
    node.expression = this.visit(node.expression);
    const parameters = node.expression.type ? [node.expression.type] : [];
    expectParameters(node, parameters, [PrimitiveType.BOOL]);
    return node;
  }

  visitBranch(node: BranchNode): Node {
    node.condition = this.visit(node.condition);
    node.ifBlock = this.visit(node.ifBlock);
    node.elseBlock = this.visitOptional(node.elseBlock);

    if (!implicitlyCastable(node.condition.type, PrimitiveType.BOOL)) {
      throw new TypeError(node, node.condition.type, PrimitiveType.BOOL);
    }

    return node;
  }

  visitCast(node: CastNode): Node {
    node.expression = this.visit(node.expression);
    node.size = this.visitOptional(node.size);

    if (!explicitlyCastable(node.expression.type, node.type)) {
      throw new CastTypeError(node);
    }

    // Variable size cast is only possible from INT to unbounded BYTES
    if (node.size) {
      if (node.expression.type !== PrimitiveType.INT || node.type.toString() !== 'bytes') {
        throw new CastSizeError(node);
      }
    }

    return node;
  }

  visitFunctionCall(node: FunctionCallNode): Node {
    node.identifier = this.visit(node.identifier) as IdentifierNode;
    node.parameters = this.visitList(node.parameters);

    const { definition, type } = node.identifier;
    if (!definition || !definition.parameters) return node; // already checked in symbol table

    const parameterTypes = node.parameters.map((p) => p.type as Type);
    expectParameters(node, parameterTypes, definition.parameters);

    // Additional array length check for checkMultiSig
    if (node.identifier.name === GlobalFunction.CHECKMULTISIG) {
      const sigs = node.parameters[0] as ArrayNode;
      const pks = node.parameters[1] as ArrayNode;
      if (sigs.elements.length > pks.elements.length) {
        throw new ArrayElementError(pks);
      }
    }

    node.type = type;
    return node;
  }

  visitInstantiation(node: InstantiationNode): Node {
    node.identifier = this.visit(node.identifier) as IdentifierNode;
    node.parameters = this.visitList(node.parameters);

    const { definition, type } = node.identifier;
    if (!definition || !definition.parameters) return node; // already checked in symbol table

    const parameterTypes = node.parameters.map((p) => p.type as Type);
    expectParameters(node, parameterTypes, definition.parameters);

    node.type = type;
    return node;
  }

  visitTupleIndexOp(node: TupleIndexOpNode): Node {
    node.tuple = this.visit(node.tuple);

    expectTuple(node, node.tuple.type);

    if (node.index !== 0 && node.index !== 1) {
      throw new IndexOutOfBoundsError(node);
    }

    node.type = (node.tuple.type as TupleType).elementType;
    return node;
  }

  visitBinaryOp(node: BinaryOpNode): Node {
    node.left = this.visit(node.left);
    node.right = this.visit(node.right);

    const resType = resultingType(node.left.type, node.right.type);
    if (!resType && !node.operator.startsWith('.')) {
      throw new UnequalTypeError(node);
    }

    switch (node.operator) {
      case BinaryOperator.PLUS:
        expectAnyOfTypes(node, resType, [PrimitiveType.INT, PrimitiveType.STRING, new BytesType()]);
        node.type = resType;
        // Infer new bounded bytes type if both operands are bounded bytes types
        if (node.left.type instanceof BytesType && node.right.type instanceof BytesType) {
          if (node.left.type.bound && node.right.type.bound) {
            node.type = new BytesType(node.left.type.bound + node.right.type.bound);
          }
        }
        return node;
      case BinaryOperator.MUL:
      case BinaryOperator.DIV:
      case BinaryOperator.MOD:
      case BinaryOperator.MINUS:
        expectInt(node, resType);
        node.type = resType;
        return node;
      case BinaryOperator.LT:
      case BinaryOperator.LE:
      case BinaryOperator.GT:
      case BinaryOperator.GE:
        expectInt(node, resType);
        node.type = PrimitiveType.BOOL;
        return node;
      case BinaryOperator.EQ:
      case BinaryOperator.NE:
        node.type = PrimitiveType.BOOL;
        return node;
      case BinaryOperator.AND:
      case BinaryOperator.OR:
        expectBool(node, resType);
        node.type = PrimitiveType.BOOL;
        return node;
      case BinaryOperator.BIT_AND:
      case BinaryOperator.BIT_OR:
      case BinaryOperator.BIT_XOR:
        expectSameSizeBytes(node, node.left.type, node.right.type);
        node.type = node.left.type;
        return node;
      case BinaryOperator.BIT_LSHIFT:
      case BinaryOperator.BIT_RSHIFT:
        throw new UnsupportedOperatorError(node);
      case BinaryOperator.SPLIT:
        expectAnyOfTypes(node, node.left.type, [new BytesType(), PrimitiveType.STRING]);
        expectInt(node, node.right.type);

        // Result of split are two unbounded bytes types (could be improved to do type inference)
        node.type = new TupleType(
          node.left.type instanceof BytesType ? new BytesType() : PrimitiveType.STRING,
        );
        return node;
      default:
        return node;
    }
  }

  visitUnaryOp(node: UnaryOpNode): Node {
    node.expression = this.visit(node.expression);

    switch (node.operator) {
      case UnaryOperator.NOT:
        expectBool(node, node.expression.type);
        node.type = PrimitiveType.BOOL;
        return node;
      case UnaryOperator.NEGATE:
        expectInt(node, node.expression.type);
        node.type = PrimitiveType.INT;
        return node;
      case UnaryOperator.SIZE:
        expectAnyOfTypes(node, node.expression.type, [new BytesType(), PrimitiveType.STRING]);
        node.type = PrimitiveType.INT;
        return node;
      case UnaryOperator.REVERSE:
        expectAnyOfTypes(node, node.expression.type, [new BytesType(), PrimitiveType.STRING]);
        // Type is preserved
        node.type = node.expression.type;
        return node;
      case UnaryOperator.INPUT_VALUE:
      case UnaryOperator.INPUT_OUTPOINT_INDEX:
      case UnaryOperator.INPUT_SEQUENCE_NUMBER:
      case UnaryOperator.INPUT_STATESEPARATOR_INDEX:
      case UnaryOperator.OUTPUT_VALUE:
      case UnaryOperator.OUTPUT_STATESEPARATOR_INDEX:
        expectInt(node, node.expression.type);
        node.type = PrimitiveType.INT;
        return node;
      case UnaryOperator.INPUT_LOCKING_BYTECODE:
      case UnaryOperator.INPUT_UNLOCKING_BYTECODE:
      case UnaryOperator.OUTPUT_LOCKING_BYTECODE:
        expectInt(node, node.expression.type);
        node.type = new BytesType();
        return node;
      case UnaryOperator.INPUT_OUTPOINT_HASH:
      case UnaryOperator.INPUT_REFHASH_DATA_SUMMARY:
      case UnaryOperator.INPUT_CODESCRIPTBYTECODE:
      case UnaryOperator.INPUT_STATESCRIPTBYTECODE:
      case UnaryOperator.OUTPUT_REFHASH_DATA_SUMMARY:
      case UnaryOperator.OUTPUT_CODESCRIPTBYTECODE:
      case UnaryOperator.OUTPUT_STATESCRIPTBYTECODE:
        expectInt(node, node.expression.type);
        node.type = new BytesType(32);
        return node;
      case UnaryOperator.INPUT_REF_DATA_SUMMARY:
      case UnaryOperator.OUTPUT_REF_DATA_SUMMARY:
        expectInt(node, node.expression.type);
        node.type = new BytesType();
        return node;
      case UnaryOperator.TX_STATE:
        expectInt(node, node.expression.type);
        node.type = new BytesType();
        return node;
      default:
        return node;
    }
  }

  visitNullaryOp(node: NullaryOpNode): Node {
    switch (node.operator) {
      case NullaryOperator.INPUT_INDEX:
      case NullaryOperator.INPUT_COUNT:
      case NullaryOperator.OUTPUT_COUNT:
      case NullaryOperator.VERSION:
      case NullaryOperator.LOCKTIME:
        node.type = PrimitiveType.INT;
        return node;
      case NullaryOperator.BYTECODE:
        node.type = new BytesType();
        return node;
      default:
        return node;
    }
  }

  visitArray(node: ArrayNode): Node {
    node.elements = this.visitList(node.elements);

    const elementTypes = node.elements.map((e) => {
      if (!e.type) throw new ArrayElementError(node);
      return e.type;
    });

    const elementType = arrayType(elementTypes);

    if (!elementType) {
      throw new ArrayElementError(node);
    }

    node.type = new ArrayType(elementType);
    return node;
  }

  visitIdentifier(node: IdentifierNode): Node {
    if (!node.definition) return node;
    node.type = node.definition.type;
    return node;
  }

  visitPushData(node: PushDataNode): Node {
    node.data = this.visit(node.data) as (HexLiteralNode | IdentifierNode);
    expectAnyOfTypes(node, node.data.type, [new BytesType()]);

    const identifier = (node.data as IdentifierNode);
    if (identifier.name) {
      const parameter = identifier.definition?.definition as ParameterNode;
      if (parameter?.modifier !== Modifier.INLINE) {
        throw new PushTypeError(node.data);
      }
    }

    node.type = PrimitiveType.BOOL;
    return node;
  }

  visitPushRef(node: PushRefNode): Node {
    node.ref = this.visit(node.ref) as (HexLiteralNode | IdentifierNode);
    expectAnyOfTypes(node, node.ref.type, [new BytesType(36)]);

    const identifier = (node.ref as IdentifierNode);
    if (identifier.name) {
      const parameter = identifier.definition?.definition as ParameterNode;
      if (parameter?.modifier !== Modifier.INLINE) {
        throw new PushTypeError(node.ref);
      }
    }

    node.type = new BytesType(36);
    return node;
  }
}

type ExpectedNode =
  BinaryOpNode | UnaryOpNode | TimeOpNode | TupleIndexOpNode | PushRefNode | PushDataNode;
function expectAnyOfTypes(node: ExpectedNode, actual?: Type, expectedTypes?: Type[]): void {
  if (!expectedTypes || expectedTypes.length === 0) return;
  if (expectedTypes.find((expected) => implicitlyCastable(actual, expected))) {
    return;
  }

  throw new UnsupportedTypeError(node, actual, expectedTypes[0]);
}

function expectBool(node: ExpectedNode, actual?: Type): void {
  expectAnyOfTypes(node, actual, [PrimitiveType.BOOL]);
}

function expectInt(node: ExpectedNode, actual?: Type): void {
  expectAnyOfTypes(node, actual, [PrimitiveType.INT]);
}

function expectSameSizeBytes(node: BinaryOpNode, left?: Type, right?: Type): void {
  if (!(left instanceof BytesType) || !(right instanceof BytesType)) {
    throw new UnsupportedTypeError(node, left, new BytesType());
  }

  if (left.bound !== right.bound) {
    throw new UnequalTypeError(node);
  }
}

function expectTuple(node: ExpectedNode, actual?: Type): void {
  if (!(actual instanceof TupleType)) {
    throw new UnsupportedTypeError(node, actual, new TupleType());
  }
}

type AssigningNode = AssignNode | VariableDefinitionNode;
function expectAssignable(node: AssigningNode, actual?: Type, expected?: Type): void {
  if (!implicitlyCastable(actual, expected)) {
    throw new AssignTypeError(node);
  }
}

type NodeWithParameters = FunctionCallNode | RequireNode | InstantiationNode;
function expectParameters(node: NodeWithParameters, actual: Type[], expected: Type[]): void {
  if (!implicitlyCastableSignature(actual, expected)) {
    throw new InvalidParameterTypeError(node, actual, expected);
  }
}
