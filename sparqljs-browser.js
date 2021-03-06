(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.sparqljs = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
var XSD_INTEGER = 'http://www.w3.org/2001/XMLSchema#integer';

function Generator(options, prefixes) {
  this._options = options || {};

  prefixes = prefixes || {};
  this._prefixByIri = {};
  var prefixIris = [];
  for (var prefix in prefixes) {
    var iri = prefixes[prefix];
    if (typeof iri === 'string') {
      this._prefixByIri[iri] = prefix;
      prefixIris.push(iri);
    }
  }
  var iriList = prefixIris.join('|').replace(/[\]\/\(\)\*\+\?\.\\\$]/g, '\\$&');
  this._prefixRegex = new RegExp('^(' + iriList + ')([a-zA-Z][\\-_a-zA-Z0-9]*)$');
  this._usedPrefixes = {};
}

// Converts the parsed query object into a SPARQL query
Generator.prototype.toQuery = function (q) {
  var query = '';

  if (q.queryType)
    query += q.queryType.toUpperCase() + ' ';
  if (q.reduced)
    query += 'REDUCED ';
  if (q.distinct)
    query += 'DISTINCT ';

  if (q.variables)
    query += mapJoin(q.variables, undefined, function (variable) {
      return isString(variable) ? this.toEntity(variable) :
             '(' + this.toExpression(variable.expression) + ' AS ' + variable.variable + ')';
    }, this) + ' ';
  else if (q.template)
    query += this.group(q.template, true) + '\n';

  if (q.from)
    query += mapJoin(q.from.default || [], '', function (g) { return 'FROM ' + this.toEntity(g) + '\n'; }, this) +
             mapJoin(q.from.named || [], '', function (g) { return 'FROM NAMED ' + this.toEntity(g) + '\n'; }, this);
  if (q.where)
    query += 'WHERE ' + this.group(q.where, true)  + '\n';

  if (q.updates)
    query += mapJoin(q.updates, ';\n', this.toUpdate, this);

  if (q.group)
    query += 'GROUP BY ' + mapJoin(q.group, undefined, function (it) {
      return isString(it.expression) ? it.expression : '(' + this.toExpression(it.expression) + ')';
    }, this) + '\n';
  if (q.having)
    query += 'HAVING (' + mapJoin(q.having, undefined, this.toExpression, this) + ')\n';
  if (q.order)
    query += 'ORDER BY ' + mapJoin(q.order, undefined, function (it) {
      var expr = this.toExpression(it.expression);
      return !it.descending ? expr : 'DESC(' + expr + ')';
    }, this) + '\n';

  if (q.offset)
    query += 'OFFSET ' + q.offset + '\n';
  if (q.limit)
    query += 'LIMIT ' + q.limit + '\n';

  if (q.values)
    query += this.values(q);

  // stringify prefixes at the end to mark used ones
  query = this.baseAndPrefixes(q) + query;
  return query.trim();
}

Generator.prototype.baseAndPrefixes = function (q) {
  var base = q.base ? ('BASE <' + q.base + '>\n') : '';
  var prefixes = '';
  for (var key in q.prefixes) {
    if (this._options.allPrefixes || this._usedPrefixes[key])
      prefixes += 'PREFIX ' + key + ': <' + q.prefixes[key] + '>\n';
  }
  return base + prefixes;
}

// Converts the parsed SPARQL pattern into a SPARQL pattern
Generator.prototype.toPattern = function (pattern) {
  var type = pattern.type || (pattern instanceof Array) && 'array' ||
             (pattern.subject && pattern.predicate && pattern.object ? 'triple' : '');
  if (!(type in this))
    throw new Error('Unknown entry type: ' + type);
  return this[type](pattern);
}

Generator.prototype.triple = function (t) {
  return this.toEntity(t.subject) + ' ' + this.toEntity(t.predicate) + ' ' + this.toEntity(t.object) + '.';
};

Generator.prototype.array = function (items) {
  return mapJoin(items, '\n', this.toPattern, this);
};

Generator.prototype.bgp = function (bgp) {
  return mapJoin(bgp.triples, '\n', this.triple, this);
};

Generator.prototype.graph = function (graph) {
  return 'GRAPH ' + this.toEntity(graph.name) + ' ' + this.group(graph);
};

Generator.prototype.group = function (group, inline) {
  group = inline !== true ? this.array(group.patterns || group.triples)
                          : this.toPattern(group.type !== 'group' ? group : group.patterns);
  return group.indexOf('\n') === -1 ? '{ ' + group + ' }' : '{\n' + indent(group) + '\n}';
};

Generator.prototype.query = function (query) {
  return '{\n' + indent(this.toQuery(query)) + '\n}';
};

Generator.prototype.filter = function (filter) {
  return 'FILTER(' + this.toExpression(filter.expression) + ')';
};

Generator.prototype.bind = function (bind) {
  return 'BIND(' + this.toExpression(bind.expression) + ' AS ' + bind.variable + ')';
};

Generator.prototype.optional = function (optional) {
  return 'OPTIONAL ' + this.group(optional);
};

Generator.prototype.union = function (union) {
  return mapJoin(union.patterns, '\nUNION\n', function (p) { return this.group(p, true); }, this);
};

Generator.prototype.minus = function (minus) {
  return 'MINUS ' + this.group(minus);
};

Generator.prototype.values = function (valuesList) {
  // Gather unique keys
  var keys = Object.keys(valuesList.values.reduce(function (keyHash, values) {
    for (var key in values) keyHash[key] = true;
    return keyHash;
  }, {}));
  // Create value rows
  return 'VALUES (' + keys.join(' ') + ') {\n' +
    mapJoin(valuesList.values, '\n', function (values) {
      return '  (' + mapJoin(keys, undefined, function (key) {
        return values[key] !== undefined ? this.toEntity(values[key]) : 'UNDEF';
      }, this) + ')';
    }, this) + '\n}';
};

Generator.prototype.service = function (service) {
  return 'SERVICE ' + (service.silent ? 'SILENT ' : '') + this.toEntity(service.name) + ' ' +
         this.group(service);
};

// Converts the parsed expression object into a SPARQL expression
Generator.prototype.toExpression = function (expr) {
  if (isString(expr))
    return this.toEntity(expr);

  switch (expr.type.toLowerCase()) {
    case 'aggregate':
      return expr.aggregation.toUpperCase() +
             '(' + (expr.distinct ? 'DISTINCT ' : '') + this.toExpression(expr.expression) +
             (expr.separator ? '; SEPARATOR = ' + this.toEntity('"' + expr.separator + '"') : '') + ')';
    case 'functioncall':
      return this.toEntity(expr.function) + '(' + mapJoin(expr.args, ', ', this.toExpression, this) + ')';
    case 'operation':
      var operator = expr.operator.toUpperCase(), args = expr.args || [];
      switch (expr.operator.toLowerCase()) {
      // Infix operators
      case '<':
      case '>':
      case '>=':
      case '<=':
      case '&&':
      case '||':
      case '=':
      case '!=':
      case '+':
      case '-':
      case '*':
      case '/':
          return (isString(args[0]) ? this.toEntity(args[0]) : '(' + this.toExpression(args[0]) + ')') +
                 ' ' + operator + ' ' +
                 (isString(args[1]) ? this.toEntity(args[1]) : '(' + this.toExpression(args[1]) + ')');
      // Unary operators
      case '!':
        return '!' + this.toExpression(args[0]);
      // IN and NOT IN
      case 'notin':
        operator = 'NOT IN';
      case 'in':
        return this.toExpression(args[0]) + ' ' + operator +
               '(' + (isString(args[1]) ? args[1] : mapJoin(args[1], ', ', this.toExpression, this)) + ')';
      // EXISTS and NOT EXISTS
      case 'notexists':
        operator = 'NOT EXISTS';
      case 'exists':
        return operator + ' ' + this.group(args[0], true);
      // Other expressions
      default:
        return operator + '(' + mapJoin(args, ', ', this.toExpression, this) + ')';
      }
    default:
      throw new Error('Unknown expression type: ' + expr.type);
  }
}

// Converts the parsed entity (or property path) into a SPARQL entity
Generator.prototype.toEntity = function (value) {
  // regular entity
  if (isString(value)) {
    switch (value[0]) {
    // variable, * selector, or blank node
    case '?':
    case '$':
    case '*':
    case '_':
      return value;
    // literal
    case '"':
      var match = value.match(/^"([^]*)"(?:(@.+)|\^\^(.+))?$/) || {},
          lexical = match[1] || '', language = match[2] || '', datatype = match[3];
      value = '"' + lexical.replace(escape, escapeReplacer) + '"' + language;
      if (datatype) {
        if (datatype === XSD_INTEGER && /^\d+$/.test(lexical))
          // Add space to avoid confusion with decimals in broken parsers
          return lexical + ' ';
        value += '^^' + this.encodeIRI(datatype);
      }
      return value;
    // IRI
    default:
      return this.encodeIRI(value);
    }
  }
  // property path
  else {
    var items = value.items.map(this.toEntity, this), path = value.pathType;
    switch (path) {
    // prefix operator
    case '^':
    case '!':
      return path + items[0];
    // postfix operator
    case '*':
    case '+':
    case '?':
      return items[0] + path;
    // infix operator
    default:
      return '(' + items.join(path) + ')';
    }
  }
}
var escape = /["\\\t\n\r\b\f]/g,
    escapeReplacer = function (c) { return escapeReplacements[c]; },
    escapeReplacements = { '\\': '\\\\', '"': '\\"', '\t': '\\t',
                           '\n': '\\n', '\r': '\\r', '\b': '\\b', '\f': '\\f' };

// Represent the IRI, as a prefixed name when possible
Generator.prototype.encodeIRI = function (iri) {
  var prefixMatch = this._prefixRegex.exec(iri);
  if (prefixMatch) {
    var prefix = this._prefixByIri[prefixMatch[1]];
    this._usedPrefixes[prefix] = true;
    return prefix + ':' + prefixMatch[2];
  }
  return '<' + iri + '>';
}

// Converts the parsed update object into a SPARQL update clause
Generator.prototype.toUpdate = function (update) {
  switch (update.type || update.updateType) {
  case 'load':
    return 'LOAD' + (update.source ? ' ' + this.toEntity(update.source) : '') +
           (update.destination ? ' INTO GRAPH ' + this.toEntity(update.destination) : '');
  case 'insert':
    return 'INSERT DATA '  + this.group(update.insert, true);
  case 'delete':
    return 'DELETE DATA '  + this.group(update.delete, true);
  case 'deletewhere':
    return 'DELETE WHERE ' + this.group(update.delete, true);
  case 'insertdelete':
    return (update.graph ? 'WITH ' + this.toEntity(update.graph) + '\n' : '') +
           (update.delete.length ? 'DELETE ' + this.group(update.delete, true) + '\n' : '') +
           (update.insert.length ? 'INSERT ' + this.group(update.insert, true) + '\n' : '') +
           'WHERE ' + this.group(update.where, true);
  case 'add':
  case 'copy':
  case 'move':
    return update.type.toUpperCase() + (update.source.default ? ' DEFAULT ' : ' ') +
           'TO ' + this.toEntity(update.destination.name);
  default:
    throw new Error('Unknown update query type: ' + update.type);
  }
}

// Checks whether the object is a string
function isString(object) { return typeof object === 'string'; }

// Maps the array with the given function, and joins the results using the separator
function mapJoin(array, sep, func, self) {
  return array.map(func, self).join(isString(sep) ? sep : ' ');
}

// Indents each line of the string
function indent(text) { return text.replace(/^/gm, '  '); }

/**
 * @param options {
 *   allPrefixes: boolean
 * }
 */
module.exports = function SparqlGenerator(options) {
  return {
    stringify: function (q) { return new Generator(options, q.prefixes).toQuery(q); }
  };
};

},{}],2:[function(require,module,exports){
(function (process){
/* parser generated by jison 0.4.16 */
/*
  Returns a Parser object of the following structure:

  Parser: {
    yy: {}
  }

  Parser.prototype: {
    yy: {},
    trace: function(),
    symbols_: {associative list: name ==> number},
    terminals_: {associative list: number ==> name},
    productions_: [...],
    performAction: function anonymous(yytext, yyleng, yylineno, yy, yystate, $$, _$),
    table: [...],
    defaultActions: {...},
    parseError: function(str, hash),
    parse: function(input),

    lexer: {
        EOF: 1,
        parseError: function(str, hash),
        setInput: function(input),
        input: function(),
        unput: function(str),
        more: function(),
        less: function(n),
        pastInput: function(),
        upcomingInput: function(),
        showPosition: function(),
        test_match: function(regex_match_array, rule_index),
        next: function(),
        lex: function(),
        begin: function(condition),
        popState: function(),
        _currentRules: function(),
        topState: function(),
        pushState: function(condition),

        options: {
            ranges: boolean           (optional: true ==> token location info will include a .range[] member)
            flex: boolean             (optional: true ==> flex-like lexing behaviour where the rules are tested exhaustively to find the longest match)
            backtrack_lexer: boolean  (optional: true ==> lexer regexes are tested in order and for each matching regex the action code is invoked; the lexer terminates the scan when a token is returned by the action code)
        },

        performAction: function(yy, yy_, $avoiding_name_collisions, YY_START),
        rules: [...],
        conditions: {associative list: name ==> set},
    }
  }


  token location info (@$, _$, etc.): {
    first_line: n,
    last_line: n,
    first_column: n,
    last_column: n,
    range: [start_number, end_number]       (where the numbers are indexes into the input string, regular zero-based)
  }


  the parseError function receives a 'hash' object with these members for lexer and parser errors: {
    text:        (matched text)
    token:       (the produced terminal token, if any)
    line:        (yylineno)
  }
  while parser (grammar) errors will also provide these members, i.e. parser errors deliver a superset of attributes: {
    loc:         (yylloc)
    expected:    (string describing the set of expected tokens)
    recoverable: (boolean: TRUE when the parser has a error recovery rule available for this particular error)
  }
*/
var SparqlParser = (function(){
var o=function(k,v,o,l){for(o=o||{},l=k.length;l--;o[k[l]]=v);return o},$V0=[11,14,23,33,42,47,95,105,108,110,111,120,121,126,292,293,294,295,296],$V1=[95,105,108,110,111,120,121,126,292,293,294,295,296],$V2=[1,21],$V3=[1,25],$V4=[6,82],$V5=[37,38,50],$V6=[37,50],$V7=[1,55],$V8=[1,57],$V9=[1,53],$Va=[1,56],$Vb=[27,28,287],$Vc=[12,15,281],$Vd=[107,129,290,297],$Ve=[12,15,107,129,281],$Vf=[1,76],$Vg=[1,80],$Vh=[1,82],$Vi=[107,129,290,291,297],$Vj=[12,15,107,129,281,291],$Vk=[1,89],$Vl=[2,231],$Vm=[1,88],$Vn=[12,15,27,28,79,163,210,213,214,267,268,269,270,271,272,273,274,275,276,277,278,279,280,281],$Vo=[6,37,38,50,60,67,70,78,80,82],$Vp=[6,12,15,27,37,38,50,60,67,70,78,80,82,281],$Vq=[6,12,15,27,28,30,31,37,38,40,50,60,67,70,78,79,80,82,89,104,107,120,121,123,128,155,156,158,161,162,163,181,192,203,208,210,211,213,214,218,222,226,241,246,263,267,268,269,270,271,272,273,274,275,276,277,278,279,280,281,287,298,301,302,304,305,306,307,308,309,310,311],$Vr=[1,104],$Vs=[1,105],$Vt=[6,12,15,27,28,38,40,79,82,107,155,156,158,161,162,163,210,213,214,267,268,269,270,271,272,273,274,275,276,277,278,279,280,281,298],$Vu=[27,31],$Vv=[2,286],$Vw=[1,118],$Vx=[1,116],$Vy=[6,192],$Vz=[2,303],$VA=[2,291],$VB=[37,123],$VC=[6,40,67,70,78,80,82],$VD=[2,233],$VE=[1,132],$VF=[1,134],$VG=[1,144],$VH=[1,150],$VI=[1,153],$VJ=[1,149],$VK=[1,151],$VL=[1,147],$VM=[1,148],$VN=[1,154],$VO=[1,155],$VP=[1,158],$VQ=[1,159],$VR=[1,160],$VS=[1,161],$VT=[1,162],$VU=[1,163],$VV=[1,164],$VW=[1,165],$VX=[1,166],$VY=[1,167],$VZ=[1,168],$V_=[1,169],$V$=[6,60,67,70,78,80,82],$V01=[27,28,37,38,50],$V11=[12,15,27,28,79,243,244,245,247,249,250,252,253,256,258,267,268,269,270,271,272,273,274,275,276,277,278,279,280,281,311,312,313,314,315,316],$V21=[2,400],$V31=[1,182],$V41=[1,183],$V51=[1,184],$V61=[12,15,40,79,89,267,268,269,270,271,272,273,274,275,276,277,278,279,280,281],$V71=[6,104,192],$V81=[40,107],$V91=[6,40,70,78,80,82],$Va1=[2,315],$Vb1=[2,307],$Vc1=[12,15,27,181,281],$Vd1=[2,343],$Ve1=[2,339],$Vf1=[12,15,27,28,31,38,40,79,82,107,155,156,158,161,162,163,181,192,203,208,210,211,213,214,246,267,268,269,270,271,272,273,274,275,276,277,278,279,280,281,298],$Vg1=[12,15,27,28,30,31,38,40,79,82,89,107,155,156,158,161,162,163,181,192,203,208,210,211,213,214,218,222,226,241,246,263,267,268,269,270,271,272,273,274,275,276,277,278,279,280,281,287,298,302,305,306,307,308,309,310,311],$Vh1=[12,15,27,28,30,31,38,40,79,82,89,107,155,156,158,161,162,163,181,192,203,208,210,211,213,214,218,222,226,241,246,263,265,266,267,268,269,270,271,272,273,274,275,276,277,278,279,280,281,287,298,302,305,306,307,308,309,310,311],$Vi1=[30,31,192,218,246],$Vj1=[30,31,192,218,222,246],$Vk1=[30,31,192,218,222,226,241,246,263,275,276,277,278,279,280,305,306,307,308,309,310,311],$Vl1=[30,31,192,218,222,226,241,246,263,275,276,277,278,279,280,287,302,305,306,307,308,309,310,311],$Vm1=[1,248],$Vn1=[1,249],$Vo1=[1,251],$Vp1=[1,252],$Vq1=[1,253],$Vr1=[1,254],$Vs1=[1,256],$Vt1=[1,257],$Vu1=[2,407],$Vv1=[1,259],$Vw1=[1,260],$Vx1=[1,261],$Vy1=[1,267],$Vz1=[1,262],$VA1=[1,263],$VB1=[1,264],$VC1=[1,265],$VD1=[1,266],$VE1=[1,274],$VF1=[1,285],$VG1=[6,40,78,80,82],$VH1=[1,302],$VI1=[1,301],$VJ1=[38,40,82,107,155,156,158,161,162],$VK1=[1,310],$VL1=[1,311],$VM1=[40,107,298],$VN1=[12,15,27,28,31,79,163,210,213,214,267,268,269,270,271,272,273,274,275,276,277,278,279,280,281],$VO1=[12,15,27,28,31,38,40,79,82,107,155,156,158,161,162,163,192,210,211,213,214,246,267,268,269,270,271,272,273,274,275,276,277,278,279,280,281,298],$VP1=[12,15,27,28,79,203,241,243,244,245,247,249,250,252,253,256,258,267,268,269,270,271,272,273,274,275,276,277,278,279,280,281,305,311,312,313,314,315,316],$VQ1=[1,337],$VR1=[1,338],$VS1=[1,340],$VT1=[1,339],$VU1=[6,12,15,27,28,30,31,38,40,67,70,73,75,78,79,80,82,107,155,156,158,161,162,163,192,210,213,214,218,222,226,241,243,244,245,246,247,249,250,252,253,256,258,263,267,268,269,270,271,272,273,274,275,276,277,278,279,280,281,287,298,302,305,306,307,308,309,310,311,312,313,314,315,316],$VV1=[1,348],$VW1=[1,347],$VX1=[28,163],$VY1=[12,15,31,40,79,89,267,268,269,270,271,272,273,274,275,276,277,278,279,280,281],$VZ1=[28,40],$V_1=[2,306],$V$1=[6,40,82],$V02=[6,12,15,28,40,70,78,80,82,243,244,245,247,249,250,252,253,256,258,281,311,312,313,314,315,316],$V12=[6,12,15,27,28,38,40,70,73,75,78,79,80,82,107,155,156,158,161,162,163,210,213,214,243,244,245,247,249,250,252,253,256,258,267,268,269,270,271,272,273,274,275,276,277,278,279,280,281,298,311,312,313,314,315,316],$V22=[6,12,15,27,28,40,67,70,78,80,82,243,244,245,247,249,250,252,253,256,258,281,311,312,313,314,315,316],$V32=[6,12,15,27,28,30,31,38,40,60,67,70,73,75,78,79,80,82,107,155,156,158,161,162,163,192,210,213,214,218,222,226,241,243,244,245,246,247,249,250,252,253,256,258,263,267,268,269,270,271,272,273,274,275,276,277,278,279,280,281,287,298,299,302,305,306,307,308,309,310,311,312,313,314,315,316],$V42=[12,15,28,181,203,208,281],$V52=[2,357],$V62=[1,389],$V72=[38,40,82,107,155,156,158,161,162,298],$V82=[2,345],$V92=[12,15,27,28,31,38,40,79,82,107,155,156,158,161,162,163,181,192,210,211,213,214,246,267,268,269,270,271,272,273,274,275,276,277,278,279,280,281,298],$Va2=[12,15,27,28,79,203,241,243,244,245,247,249,250,252,253,256,258,267,268,269,270,271,272,273,274,275,276,277,278,279,280,281,287,305,311,312,313,314,315,316],$Vb2=[1,439],$Vc2=[1,436],$Vd2=[1,437],$Ve2=[12,15,27,28,38,40,79,82,107,155,156,158,161,162,163,210,213,214,267,268,269,270,271,272,273,274,275,276,277,278,279,280,281],$Vf2=[12,15,27,281],$Vg2=[12,15,27,28,38,40,79,82,107,155,156,158,161,162,163,210,213,214,267,268,269,270,271,272,273,274,275,276,277,278,279,280,281,298],$Vh2=[2,318],$Vi2=[12,15,27,181,192,281],$Vj2=[12,15,31,79,89,267,268,269,270,271,272,273,274,275,276,277,278,279,280,281],$Vk2=[6,12,15,27,28,40,73,75,78,80,82,243,244,245,247,249,250,252,253,256,258,281,311,312,313,314,315,316],$Vl2=[2,313],$Vm2=[12,15,28,181,203,281],$Vn2=[38,40,82,107,155,156,158,161,162,192,211,298],$Vo2=[12,15,27,28,40,79,107,163,210,213,214,267,268,269,270,271,272,273,274,275,276,277,278,279,280,281],$Vp2=[12,15,27,28,31,79,163,210,213,214,267,268,269,270,271,272,273,274,275,276,277,278,279,280,281,301,302],$Vq2=[12,15,27,28,31,79,163,210,213,214,267,268,269,270,271,272,273,274,275,276,277,278,279,280,281,287,301,302,304,305],$Vr2=[1,549],$Vs2=[1,550],$Vt2=[2,301],$Vu2=[12,15,31,181,208,281];
var parser = {trace: function trace() { },
yy: {},
symbols_: {"error":2,"QueryOrUpdateUnit":3,"QueryOrUpdateUnit_repetition0":4,"QueryOrUpdateUnit_group0":5,"EOF":6,"Query":7,"Query_group0":8,"Query_option0":9,"BaseDecl":10,"BASE":11,"IRIREF":12,"PrefixDecl":13,"PREFIX":14,"PNAME_NS":15,"SelectQuery":16,"SelectClause":17,"SelectQuery_repetition0":18,"WhereClause":19,"SolutionModifier":20,"SubSelect":21,"SubSelect_option0":22,"SELECT":23,"SelectClause_option0":24,"SelectClause_group0":25,"SelectClauseItem":26,"VAR":27,"(":28,"Expression":29,"AS":30,")":31,"ConstructQuery":32,"CONSTRUCT":33,"ConstructTemplate":34,"ConstructQuery_repetition0":35,"ConstructQuery_repetition1":36,"WHERE":37,"{":38,"ConstructQuery_option0":39,"}":40,"DescribeQuery":41,"DESCRIBE":42,"DescribeQuery_group0":43,"DescribeQuery_repetition0":44,"DescribeQuery_option0":45,"AskQuery":46,"ASK":47,"AskQuery_repetition0":48,"DatasetClause":49,"FROM":50,"DatasetClause_option0":51,"iri":52,"WhereClause_option0":53,"GroupGraphPattern":54,"SolutionModifier_option0":55,"SolutionModifier_option1":56,"SolutionModifier_option2":57,"SolutionModifier_option3":58,"GroupClause":59,"GROUP":60,"BY":61,"GroupClause_repetition_plus0":62,"GroupCondition":63,"BuiltInCall":64,"FunctionCall":65,"HavingClause":66,"HAVING":67,"HavingClause_repetition_plus0":68,"OrderClause":69,"ORDER":70,"OrderClause_repetition_plus0":71,"OrderCondition":72,"ASC":73,"BrackettedExpression":74,"DESC":75,"Constraint":76,"LimitOffsetClauses":77,"LIMIT":78,"INTEGER":79,"OFFSET":80,"ValuesClause":81,"VALUES":82,"InlineData":83,"InlineData_repetition0":84,"InlineData_repetition1":85,"InlineData_repetition2":86,"DataBlockValue":87,"Literal":88,"UNDEF":89,"DataBlockValueList":90,"DataBlockValueList_repetition0":91,"Update":92,"Update_repetition0":93,"Update1":94,"LOAD":95,"Update1_option0":96,"Update1_option1":97,"Update1_group0":98,"Update1_option2":99,"GraphRefAll":100,"Update1_group1":101,"Update1_option3":102,"GraphOrDefault":103,"TO":104,"CREATE":105,"Update1_option4":106,"GRAPH":107,"INSERTDATA":108,"QuadPattern":109,"DELETEDATA":110,"DELETEWHERE":111,"Update1_option5":112,"InsertClause":113,"Update1_option6":114,"Update1_repetition0":115,"Update1_option7":116,"DeleteClause":117,"Update1_option8":118,"Update1_repetition1":119,"DELETE":120,"INSERT":121,"UsingClause":122,"USING":123,"UsingClause_option0":124,"WithClause":125,"WITH":126,"IntoGraphClause":127,"INTO":128,"DEFAULT":129,"GraphOrDefault_option0":130,"GraphRefAll_group0":131,"QuadPattern_option0":132,"QuadPattern_repetition0":133,"QuadsNotTriples":134,"QuadsNotTriples_group0":135,"QuadsNotTriples_option0":136,"QuadsNotTriples_option1":137,"QuadsNotTriples_option2":138,"TriplesTemplate":139,"TriplesTemplate_repetition0":140,"TriplesSameSubject":141,"TriplesTemplate_option0":142,"GroupGraphPatternSub":143,"GroupGraphPatternSub_option0":144,"GroupGraphPatternSub_repetition0":145,"GroupGraphPatternSubTail":146,"GraphPatternNotTriples":147,"GroupGraphPatternSubTail_option0":148,"GroupGraphPatternSubTail_option1":149,"TriplesBlock":150,"TriplesBlock_repetition0":151,"TriplesSameSubjectPath":152,"TriplesBlock_option0":153,"GraphPatternNotTriples_repetition0":154,"OPTIONAL":155,"MINUS":156,"GraphPatternNotTriples_group0":157,"SERVICE":158,"GraphPatternNotTriples_option0":159,"GraphPatternNotTriples_group1":160,"FILTER":161,"BIND":162,"NIL":163,"FunctionCall_option0":164,"FunctionCall_repetition0":165,"ExpressionList":166,"ExpressionList_repetition0":167,"ConstructTemplate_option0":168,"ConstructTriples":169,"ConstructTriples_repetition0":170,"ConstructTriples_option0":171,"VarOrTerm":172,"PropertyListNotEmpty":173,"TriplesNode":174,"PropertyList":175,"PropertyList_option0":176,"PropertyListNotEmpty_repetition0":177,"VerbObjectList":178,"Verb":179,"ObjectList":180,"a":181,"ObjectList_repetition0":182,"GraphNode":183,"PropertyListPathNotEmpty":184,"TriplesNodePath":185,"TriplesSameSubjectPath_option0":186,"PropertyListPathNotEmpty_group0":187,"PropertyListPathNotEmpty_repetition0":188,"GraphNodePath":189,"PropertyListPathNotEmpty_repetition1":190,"PropertyListPathNotEmptyTail":191,";":192,"PropertyListPathNotEmptyTail_group0":193,"Path":194,"Path_repetition0":195,"PathSequence":196,"PathSequence_repetition0":197,"PathEltOrInverse":198,"PathElt":199,"PathPrimary":200,"PathElt_option0":201,"PathEltOrInverse_option0":202,"!":203,"PathNegatedPropertySet":204,"PathOneInPropertySet":205,"PathNegatedPropertySet_repetition0":206,"PathNegatedPropertySet_option0":207,"^":208,"TriplesNode_repetition_plus0":209,"[":210,"]":211,"TriplesNodePath_repetition_plus0":212,"BLANK_NODE_LABEL":213,"ANON":214,"ConditionalAndExpression":215,"Expression_repetition0":216,"ExpressionTail":217,"||":218,"RelationalExpression":219,"ConditionalAndExpression_repetition0":220,"ConditionalAndExpressionTail":221,"&&":222,"AdditiveExpression":223,"RelationalExpression_group0":224,"RelationalExpression_option0":225,"IN":226,"MultiplicativeExpression":227,"AdditiveExpression_repetition0":228,"AdditiveExpressionTail":229,"AdditiveExpressionTail_group0":230,"NumericLiteralPositive":231,"AdditiveExpressionTail_repetition0":232,"NumericLiteralNegative":233,"AdditiveExpressionTail_repetition1":234,"UnaryExpression":235,"MultiplicativeExpression_repetition0":236,"MultiplicativeExpressionTail":237,"MultiplicativeExpressionTail_group0":238,"UnaryExpression_option0":239,"PrimaryExpression":240,"-":241,"Aggregate":242,"FUNC_ARITY0":243,"FUNC_ARITY1":244,"FUNC_ARITY2":245,",":246,"IF":247,"BuiltInCall_group0":248,"BOUND":249,"BNODE":250,"BuiltInCall_option0":251,"EXISTS":252,"COUNT":253,"Aggregate_option0":254,"Aggregate_group0":255,"FUNC_AGGREGATE":256,"Aggregate_option1":257,"GROUP_CONCAT":258,"Aggregate_option2":259,"Aggregate_option3":260,"GroupConcatSeparator":261,"SEPARATOR":262,"=":263,"String":264,"LANGTAG":265,"^^":266,"DECIMAL":267,"DOUBLE":268,"true":269,"false":270,"STRING_LITERAL1":271,"STRING_LITERAL2":272,"STRING_LITERAL_LONG1":273,"STRING_LITERAL_LONG2":274,"INTEGER_POSITIVE":275,"DECIMAL_POSITIVE":276,"DOUBLE_POSITIVE":277,"INTEGER_NEGATIVE":278,"DECIMAL_NEGATIVE":279,"DOUBLE_NEGATIVE":280,"PNAME_LN":281,"QueryOrUpdateUnit_repetition0_group0":282,"SelectClause_option0_group0":283,"DISTINCT":284,"REDUCED":285,"SelectClause_group0_repetition_plus0":286,"*":287,"DescribeQuery_group0_repetition_plus0_group0":288,"DescribeQuery_group0_repetition_plus0":289,"NAMED":290,"SILENT":291,"CLEAR":292,"DROP":293,"ADD":294,"MOVE":295,"COPY":296,"ALL":297,".":298,"UNION":299,"PropertyListNotEmpty_repetition0_repetition_plus0":300,"|":301,"/":302,"PathElt_option0_group0":303,"?":304,"+":305,"!=":306,"<":307,">":308,"<=":309,">=":310,"NOT":311,"CONCAT":312,"COALESCE":313,"SUBSTR":314,"REGEX":315,"REPLACE":316,"$accept":0,"$end":1},
terminals_: {2:"error",6:"EOF",11:"BASE",12:"IRIREF",14:"PREFIX",15:"PNAME_NS",23:"SELECT",27:"VAR",28:"(",30:"AS",31:")",33:"CONSTRUCT",37:"WHERE",38:"{",40:"}",42:"DESCRIBE",47:"ASK",50:"FROM",60:"GROUP",61:"BY",67:"HAVING",70:"ORDER",73:"ASC",75:"DESC",78:"LIMIT",79:"INTEGER",80:"OFFSET",82:"VALUES",89:"UNDEF",95:"LOAD",104:"TO",105:"CREATE",107:"GRAPH",108:"INSERTDATA",110:"DELETEDATA",111:"DELETEWHERE",120:"DELETE",121:"INSERT",123:"USING",126:"WITH",128:"INTO",129:"DEFAULT",155:"OPTIONAL",156:"MINUS",158:"SERVICE",161:"FILTER",162:"BIND",163:"NIL",181:"a",192:";",203:"!",208:"^",210:"[",211:"]",213:"BLANK_NODE_LABEL",214:"ANON",218:"||",222:"&&",226:"IN",241:"-",243:"FUNC_ARITY0",244:"FUNC_ARITY1",245:"FUNC_ARITY2",246:",",247:"IF",249:"BOUND",250:"BNODE",252:"EXISTS",253:"COUNT",256:"FUNC_AGGREGATE",258:"GROUP_CONCAT",262:"SEPARATOR",263:"=",265:"LANGTAG",266:"^^",267:"DECIMAL",268:"DOUBLE",269:"true",270:"false",271:"STRING_LITERAL1",272:"STRING_LITERAL2",273:"STRING_LITERAL_LONG1",274:"STRING_LITERAL_LONG2",275:"INTEGER_POSITIVE",276:"DECIMAL_POSITIVE",277:"DOUBLE_POSITIVE",278:"INTEGER_NEGATIVE",279:"DECIMAL_NEGATIVE",280:"DOUBLE_NEGATIVE",281:"PNAME_LN",284:"DISTINCT",285:"REDUCED",287:"*",290:"NAMED",291:"SILENT",292:"CLEAR",293:"DROP",294:"ADD",295:"MOVE",296:"COPY",297:"ALL",298:".",299:"UNION",301:"|",302:"/",304:"?",305:"+",306:"!=",307:"<",308:">",309:"<=",310:">=",311:"NOT",312:"CONCAT",313:"COALESCE",314:"SUBSTR",315:"REGEX",316:"REPLACE"},
productions_: [0,[3,3],[7,2],[10,2],[13,3],[16,4],[21,4],[17,3],[26,1],[26,5],[32,5],[32,7],[41,5],[46,4],[49,3],[19,2],[20,4],[59,3],[63,1],[63,1],[63,3],[63,5],[63,1],[66,2],[69,3],[72,2],[72,2],[72,1],[72,1],[77,2],[77,2],[77,4],[77,4],[81,2],[83,4],[83,6],[87,1],[87,1],[87,1],[90,3],[92,2],[94,4],[94,3],[94,5],[94,4],[94,2],[94,2],[94,2],[94,6],[94,6],[117,2],[113,2],[122,3],[125,2],[127,3],[103,1],[103,2],[100,2],[100,1],[109,4],[134,7],[139,3],[54,3],[54,3],[143,2],[146,3],[150,3],[147,2],[147,2],[147,2],[147,3],[147,4],[147,2],[147,6],[147,1],[76,1],[76,1],[76,1],[65,2],[65,6],[166,1],[166,4],[34,3],[169,3],[141,2],[141,2],[175,1],[173,2],[178,2],[179,1],[179,1],[179,1],[180,2],[152,2],[152,2],[184,4],[191,1],[191,3],[194,2],[196,2],[199,2],[198,2],[200,1],[200,1],[200,2],[200,3],[204,1],[204,1],[204,4],[205,1],[205,1],[205,2],[205,2],[174,3],[174,3],[185,3],[185,3],[183,1],[183,1],[189,1],[189,1],[172,1],[172,1],[172,1],[172,1],[172,1],[172,1],[29,2],[217,2],[215,2],[221,2],[219,1],[219,3],[219,4],[223,2],[229,2],[229,2],[229,2],[227,2],[237,2],[235,2],[235,2],[235,2],[240,1],[240,1],[240,1],[240,1],[240,1],[240,1],[74,3],[64,1],[64,2],[64,4],[64,6],[64,8],[64,2],[64,4],[64,2],[64,4],[64,3],[242,5],[242,5],[242,6],[261,4],[88,1],[88,2],[88,3],[88,1],[88,1],[88,1],[88,1],[88,1],[88,1],[88,1],[264,1],[264,1],[264,1],[264,1],[231,1],[231,1],[231,1],[233,1],[233,1],[233,1],[52,1],[52,1],[52,1],[282,1],[282,1],[4,0],[4,2],[5,1],[5,1],[8,1],[8,1],[8,1],[8,1],[9,0],[9,1],[18,0],[18,2],[22,0],[22,1],[283,1],[283,1],[24,0],[24,1],[286,1],[286,2],[25,1],[25,1],[35,0],[35,2],[36,0],[36,2],[39,0],[39,1],[288,1],[288,1],[289,1],[289,2],[43,1],[43,1],[44,0],[44,2],[45,0],[45,1],[48,0],[48,2],[51,0],[51,1],[53,0],[53,1],[55,0],[55,1],[56,0],[56,1],[57,0],[57,1],[58,0],[58,1],[62,1],[62,2],[68,1],[68,2],[71,1],[71,2],[84,0],[84,2],[85,0],[85,2],[86,0],[86,2],[91,0],[91,2],[93,0],[93,3],[96,0],[96,1],[97,0],[97,1],[98,1],[98,1],[99,0],[99,1],[101,1],[101,1],[101,1],[102,0],[102,1],[106,0],[106,1],[112,0],[112,1],[114,0],[114,1],[115,0],[115,2],[116,0],[116,1],[118,0],[118,1],[119,0],[119,2],[124,0],[124,1],[130,0],[130,1],[131,1],[131,1],[131,1],[132,0],[132,1],[133,0],[133,2],[135,1],[135,1],[136,0],[136,1],[137,0],[137,1],[138,0],[138,1],[140,0],[140,3],[142,0],[142,1],[144,0],[144,1],[145,0],[145,2],[148,0],[148,1],[149,0],[149,1],[151,0],[151,3],[153,0],[153,1],[154,0],[154,3],[157,1],[157,1],[159,0],[159,1],[160,1],[160,1],[164,0],[164,1],[165,0],[165,3],[167,0],[167,3],[168,0],[168,1],[170,0],[170,3],[171,0],[171,1],[176,0],[176,1],[300,1],[300,2],[177,0],[177,3],[182,0],[182,3],[186,0],[186,1],[187,1],[187,1],[188,0],[188,3],[190,0],[190,2],[193,1],[193,1],[195,0],[195,3],[197,0],[197,3],[303,1],[303,1],[303,1],[201,0],[201,1],[202,0],[202,1],[206,0],[206,3],[207,0],[207,1],[209,1],[209,2],[212,1],[212,2],[216,0],[216,2],[220,0],[220,2],[224,1],[224,1],[224,1],[224,1],[224,1],[224,1],[225,0],[225,1],[228,0],[228,2],[230,1],[230,1],[232,0],[232,2],[234,0],[234,2],[236,0],[236,2],[238,1],[238,1],[239,0],[239,1],[248,1],[248,1],[248,1],[248,1],[248,1],[251,0],[251,1],[254,0],[254,1],[255,1],[255,1],[257,0],[257,1],[259,0],[259,1],[260,0],[260,1]],
performAction: function anonymous(yytext, yyleng, yylineno, yy, yystate /* action[1] */, $$ /* vstack */, _$ /* lstack */) {
/* this == yyval */

var $0 = $$.length - 1;
switch (yystate) {
case 1:

      if (Parser.base)
        $$[$0-1].base = Parser.base;
      Parser.base = base = basePath = baseRoot = '';
      $$[$0-1].prefixes = Parser.prefixes;
      Parser.prefixes = null;
      return $$[$0-1];
    
break;
case 2:
this.$ = extend($$[$0-1], $$[$0], { type: 'query' });
break;
case 3:

      Parser.base = resolveIRI($$[$0])
      base = basePath = baseRoot = '';
    
break;
case 4:

      if (!Parser.prefixes) Parser.prefixes = {};
      $$[$0-1] = $$[$0-1].substr(0, $$[$0-1].length - 1);
      $$[$0] = resolveIRI($$[$0]);
      Parser.prefixes[$$[$0-1]] = $$[$0];
    
break;
case 5:
this.$ = extend($$[$0-3], groupDatasets($$[$0-2]), $$[$0-1], $$[$0]);
break;
case 6:
this.$ = extend({ type: 'query' }, $$[$0-3], $$[$0-2], $$[$0-1], $$[$0]);
break;
case 7:
this.$ = extend({ queryType: 'SELECT', variables: $$[$0] === '*' ? ['*'] : $$[$0] }, $$[$0-1] && ($$[$0-2] = lowercase($$[$0-1]), $$[$0-1] = {}, $$[$0-1][$$[$0-2]] = true, $$[$0-1]));
break;
case 8: case 89: case 121: case 148:
this.$ = toVar($$[$0]);
break;
case 9: case 21:
this.$ = expression($$[$0-3], { variable: toVar($$[$0-1]) });
break;
case 10:
this.$ = extend({ queryType: 'CONSTRUCT', template: $$[$0-3] }, groupDatasets($$[$0-2]), $$[$0-1], $$[$0]);
break;
case 11:
this.$ = extend({ queryType: 'CONSTRUCT', template: $$[$0-2] = ($$[$0-2] ? $$[$0-2].triples : []) }, groupDatasets($$[$0-5]), { where: [ { type: 'bgp', triples: appendAllTo([], $$[$0-2]) } ] }, $$[$0]);
break;
case 12:
this.$ = extend({ queryType: 'DESCRIBE', variables: $$[$0-3] === '*' ? ['*'] : $$[$0-3].map(toVar) }, groupDatasets($$[$0-2]), $$[$0-1], $$[$0]);
break;
case 13:
this.$ = extend({ queryType: 'ASK' }, groupDatasets($$[$0-2]), $$[$0-1], $$[$0]);
break;
case 14: case 52:
this.$ = { iri: $$[$0], named: !!$$[$0-1] };
break;
case 15:
this.$ = { where: $$[$0].patterns };
break;
case 16:
this.$ = extend($$[$0-3], $$[$0-2], $$[$0-1], $$[$0]);
break;
case 17:
this.$ = { group: $$[$0] };
break;
case 18: case 19: case 25: case 27:
this.$ = expression($$[$0]);
break;
case 20:
this.$ = expression($$[$0-1]);
break;
case 22: case 28:
this.$ = expression(toVar($$[$0]));
break;
case 23:
this.$ = { having: $$[$0] };
break;
case 24:
this.$ = { order: $$[$0] };
break;
case 26:
this.$ = expression($$[$0], { descending: true });
break;
case 29:
this.$ = { limit:  toInt($$[$0]) };
break;
case 30:
this.$ = { offset: toInt($$[$0]) };
break;
case 31:
this.$ = { limit: toInt($$[$0-2]), offset: toInt($$[$0]) };
break;
case 32:
this.$ = { limit: toInt($$[$0]), offset: toInt($$[$0-2]) };
break;
case 33:
this.$ = { type: 'values', values: $$[$0] };
break;
case 34:

      $$[$0-3] = toVar($$[$0-3]);
      this.$ = $$[$0-1].map(function(v) { var o = {}; o[$$[$0-3]] = v; return o; })
    
break;
case 35:

      var length = $$[$0-4].length;
      $$[$0-4] = $$[$0-4].map(toVar);
      this.$ = $$[$0-1].map(function (values) {
        if (values.length !== length)
          throw Error('Inconsistent VALUES length');
        var valuesObject = {};
        for(var i = 0; i<length; i++)
          valuesObject[$$[$0-4][i]] = values[i];
        return valuesObject;
      });
    
break;
case 38:
this.$ = undefined;
break;
case 39: case 62: case 82: case 105: case 149:
this.$ = $$[$0-1];
break;
case 40:
this.$ = { type: 'update', updates: appendTo($$[$0-1], $$[$0]) };
break;
case 41:
this.$ = extend({ type: 'load', silent: !!$$[$0-2], source: $$[$0-1] }, $$[$0] && { destination: $$[$0] });
break;
case 42:
this.$ = { type: lowercase($$[$0-2]), silent: !!$$[$0-1], graph: $$[$0] };
break;
case 43:
this.$ = { type: lowercase($$[$0-4]), silent: !!$$[$0-3], source: $$[$0-2], destination: $$[$0] };
break;
case 44:
this.$ = { type: 'create', silent: !!$$[$0-2], graph: $$[$0-1] };
break;
case 45:
this.$ = { updateType: 'insert',      insert: $$[$0] };
break;
case 46:
this.$ = { updateType: 'delete',      delete: $$[$0] };
break;
case 47:
this.$ = { updateType: 'deletewhere', delete: $$[$0] };
break;
case 48:
this.$ = extend({ updateType: 'insertdelete' }, $$[$0-5], { insert: $$[$0-4] || [] }, { delete: $$[$0-3] || [] }, groupDatasets($$[$0-2]), { where: $$[$0].patterns });
break;
case 49:
this.$ = extend({ updateType: 'insertdelete' }, $$[$0-5], { delete: $$[$0-4] || [] }, { insert: $$[$0-3] || [] }, groupDatasets($$[$0-2]), { where: $$[$0].patterns });
break;
case 50: case 51: case 54: case 140:
this.$ = $$[$0];
break;
case 53:
this.$ = { graph: $$[$0] };
break;
case 55:
this.$ = { type: 'graph', default: true };
break;
case 56: case 57:
this.$ = { type: 'graph', name: $$[$0] };
break;
case 58:
 this.$ = {}; this.$[lowercase($$[$0])] = true; 
break;
case 59:
this.$ = $$[$0-2] ? unionAll($$[$0-1], [$$[$0-2]]) : unionAll($$[$0-1]);
break;
case 60:

      var graph = extend($$[$0-3] || { triples: [] }, { type: 'graph', name: toVar($$[$0-5]) });
      this.$ = $$[$0] ? [graph, $$[$0]] : [graph];
    
break;
case 61: case 66:
this.$ = { type: 'bgp', triples: unionAll($$[$0-2], [$$[$0-1]]) };
break;
case 63:

      if (Parser.options.collapseGroups && $$[$0-1].length > 1)
        $$[$0-1] = mergeAdjacentBGPs($$[$0-1]);
      this.$ = { type: 'group', patterns: $$[$0-1] }
    
break;
case 64:
this.$ = $$[$0-1] ? unionAll([$$[$0-1]], $$[$0]) : unionAll($$[$0]);
break;
case 65:
this.$ = $$[$0] ? [$$[$0-2], $$[$0]] : $$[$0-2];
break;
case 67:

      if ($$[$0-1].length)
        this.$ = { type: 'union', patterns: unionAll($$[$0-1].map(degroupSingle), [degroupSingle($$[$0])]) };
      else
        this.$ = Parser.options.collapseGroups ? degroupSingle($$[$0]) : $$[$0];
    
break;
case 68:
this.$ = extend($$[$0], { type: 'optional' });
break;
case 69:
this.$ = extend($$[$0], { type: 'minus' });
break;
case 70:
this.$ = extend($$[$0], { type: 'graph', name: toVar($$[$0-1]) });
break;
case 71:
this.$ = extend($$[$0], { type: 'service', name: toVar($$[$0-1]), silent: !!$$[$0-2] });
break;
case 72:
this.$ = { type: 'filter', expression: $$[$0] };
break;
case 73:
this.$ = { type: 'bind', variable: toVar($$[$0-1]), expression: $$[$0-3] };
break;
case 78:
this.$ = { type: 'functionCall', function: $$[$0-1], args: [] };
break;
case 79:
this.$ = { type: 'functionCall', function: $$[$0-5], args: appendTo($$[$0-2], $$[$0-1]), distinct: !!$$[$0-3] };
break;
case 80: case 96: case 107: case 189: case 199: case 211: case 213: case 223: case 227: case 247: case 249: case 251: case 253: case 255: case 276: case 282: case 293: case 303: case 309: case 315: case 319: case 329: case 331: case 335: case 343: case 345: case 351: case 353: case 357: case 359: case 368: case 376: case 378: case 388: case 392: case 394: case 396:
this.$ = [];
break;
case 81:
this.$ = appendTo($$[$0-2], $$[$0-1]);
break;
case 83:
this.$ = unionAll($$[$0-2], [$$[$0-1]]);
break;
case 84: case 93:
this.$ = $$[$0].map(function (t) { return extend(triple($$[$0-1]), t); });
break;
case 85:
this.$ = appendAllTo($$[$0].map(function (t) { return extend(triple($$[$0-1].entity), t); }), $$[$0-1].triples) /* the subject is a blank node, possibly with more triples */;
break;
case 87:
this.$ = unionAll($$[$0-1], [$$[$0]]);
break;
case 88:
this.$ = objectListToTriples($$[$0-1], $$[$0]);
break;
case 91: case 103: case 110:
this.$ = RDF_TYPE;
break;
case 92:
this.$ = appendTo($$[$0-1], $$[$0]);
break;
case 94:
this.$ = !$$[$0] ? $$[$0-1].triples : appendAllTo($$[$0].map(function (t) { return extend(triple($$[$0-1].entity), t); }), $$[$0-1].triples) /* the subject is a blank node, possibly with more triples */;
break;
case 95:
this.$ = objectListToTriples(toVar($$[$0-3]), appendTo($$[$0-2], $$[$0-1]), $$[$0]);
break;
case 97:
this.$ = objectListToTriples(toVar($$[$0-1]), $$[$0]);
break;
case 98:
this.$ = $$[$0-1].length ? path('|',appendTo($$[$0-1], $$[$0])) : $$[$0];
break;
case 99:
this.$ = $$[$0-1].length ? path('/', appendTo($$[$0-1], $$[$0])) : $$[$0];
break;
case 100:
this.$ = $$[$0] ? path($$[$0], [$$[$0-1]]) : $$[$0-1];
break;
case 101:
this.$ = $$[$0-1] ? path($$[$0-1], [$$[$0]]) : $$[$0];;
break;
case 104: case 111:
this.$ = path($$[$0-1], [$$[$0]]);
break;
case 108:
this.$ = path('|', appendTo($$[$0-2], $$[$0-1]));
break;
case 112:
this.$ = path($$[$0-1], [RDF_TYPE]);
break;
case 113: case 115:
this.$ = createList($$[$0-1]);
break;
case 114: case 116:
this.$ = createAnonymousObject($$[$0-1]);
break;
case 117:
this.$ = { entity: $$[$0], triples: [] } /* for consistency with TriplesNode */;
break;
case 119:
this.$ = { entity: $$[$0], triples: [] } /* for consistency with TriplesNodePath */;
break;
case 125:
this.$ = blank();
break;
case 126:
this.$ = RDF_NIL;
break;
case 127: case 129: case 134: case 138:
this.$ = createOperationTree($$[$0-1], $$[$0]);
break;
case 128:
this.$ = ['||', $$[$0]];
break;
case 130:
this.$ = ['&&', $$[$0]];
break;
case 132:
this.$ = operation($$[$0-1], [$$[$0-2], $$[$0]]);
break;
case 133:
this.$ = operation($$[$0-2] ? 'notin' : 'in', [$$[$0-3], $$[$0]]);
break;
case 135: case 139:
this.$ = [$$[$0-1], $$[$0]];
break;
case 136:
this.$ = ['+', createOperationTree($$[$0-1], $$[$0])];
break;
case 137:
this.$ = ['-', createOperationTree($$[$0-1].replace('-', ''), $$[$0])];
break;
case 141:
this.$ = operation($$[$0-1], [$$[$0]]);
break;
case 142:
this.$ = operation('UMINUS', [$$[$0]]);
break;
case 151:
this.$ = operation(lowercase($$[$0-1]));
break;
case 152:
this.$ = operation(lowercase($$[$0-3]), [$$[$0-1]]);
break;
case 153:
this.$ = operation(lowercase($$[$0-5]), [$$[$0-3], $$[$0-1]]);
break;
case 154:
this.$ = operation(lowercase($$[$0-7]), [$$[$0-5], $$[$0-3], $$[$0-1]]);
break;
case 155:
this.$ = operation(lowercase($$[$0-1]), $$[$0]);
break;
case 156:
this.$ = operation('bound', [toVar($$[$0-1])]);
break;
case 157:
this.$ = operation($$[$0-1], []);
break;
case 158:
this.$ = operation($$[$0-3], [$$[$0-1]]);
break;
case 159:
this.$ = operation($$[$0-2] ? 'notexists' :'exists', [degroupSingle($$[$0])]);
break;
case 160: case 161:
this.$ = expression($$[$0-1], { type: 'aggregate', aggregation: lowercase($$[$0-4]), distinct: !!$$[$0-2] });
break;
case 162:
this.$ = expression($$[$0-2], { type: 'aggregate', aggregation: lowercase($$[$0-5]), distinct: !!$$[$0-3], separator: $$[$0-1] || ' ' });
break;
case 163:
this.$ = $$[$0].substr(1, $$[$0].length - 2);
break;
case 165:
this.$ = $$[$0-1] + lowercase($$[$0]);
break;
case 166:
this.$ = $$[$0-2] + '^^' + $$[$0];
break;
case 167: case 181:
this.$ = createLiteral($$[$0], XSD_INTEGER);
break;
case 168: case 182:
this.$ = createLiteral($$[$0], XSD_DECIMAL);
break;
case 169: case 183:
this.$ = createLiteral(lowercase($$[$0]), XSD_DOUBLE);
break;
case 172:
this.$ = XSD_TRUE;
break;
case 173:
this.$ = XSD_FALSE;
break;
case 174: case 175:
this.$ = unescapeString($$[$0], 1);
break;
case 176: case 177:
this.$ = unescapeString($$[$0], 3);
break;
case 178:
this.$ = createLiteral($$[$0].substr(1), XSD_INTEGER);
break;
case 179:
this.$ = createLiteral($$[$0].substr(1), XSD_DECIMAL);
break;
case 180:
this.$ = createLiteral($$[$0].substr(1).toLowerCase(), XSD_DOUBLE);
break;
case 184:
this.$ = resolveIRI($$[$0]);
break;
case 185:

      var namePos = $$[$0].indexOf(':'),
          prefix = $$[$0].substr(0, namePos),
          expansion = Parser.prefixes[prefix];
      if (!expansion) throw new Error('Unknown prefix: ' + prefix);
      this.$ = resolveIRI(expansion + $$[$0].substr(namePos + 1));
    
break;
case 186:

      $$[$0] = $$[$0].substr(0, $$[$0].length - 1);
      if (!($$[$0] in Parser.prefixes)) throw new Error('Unknown prefix: ' + $$[$0]);
      this.$ = resolveIRI(Parser.prefixes[$$[$0]]);
    
break;
case 190: case 200: case 208: case 212: case 214: case 220: case 224: case 228: case 242: case 244: case 246: case 248: case 250: case 252: case 254: case 277: case 283: case 294: case 310: case 342: case 354: case 373: case 375: case 377: case 379: case 389: case 393: case 395: case 397:
$$[$0-1].push($$[$0]);
break;
case 207: case 219: case 241: case 243: case 245: case 341: case 372: case 374:
this.$ = [$$[$0]];
break;
case 256: case 304: case 316: case 320: case 330: case 332: case 336: case 344: case 346: case 352: case 358: case 360: case 369:
$$[$0-2].push($$[$0-1]);
break;
}
},
table: [o($V0,[2,189],{3:1,4:2}),{1:[3]},o($V1,[2,255],{5:3,282:4,7:5,92:6,10:7,13:8,8:9,93:10,16:13,32:14,41:15,46:16,17:17,11:[1,11],14:[1,12],23:$V2,33:[1,18],42:[1,19],47:[1,20]}),{6:[1,22]},o($V0,[2,190]),{6:[2,191]},{6:[2,192]},o($V0,[2,187]),o($V0,[2,188]),{6:[2,197],9:23,81:24,82:$V3},{94:26,95:[1,27],98:28,101:29,105:[1,30],108:[1,31],110:[1,32],111:[1,33],112:34,116:35,120:[2,278],121:[2,272],125:41,126:[1,42],292:[1,36],293:[1,37],294:[1,38],295:[1,39],296:[1,40]},{12:[1,43]},{15:[1,44]},o($V4,[2,193]),o($V4,[2,194]),o($V4,[2,195]),o($V4,[2,196]),o($V5,[2,199],{18:45}),o($V6,[2,213],{34:46,36:47,38:[1,48]}),{12:$V7,15:$V8,27:$V9,43:49,52:54,281:$Va,287:[1,51],288:52,289:50},o($V5,[2,227],{48:58}),o($Vb,[2,205],{24:59,283:60,284:[1,61],285:[1,62]}),{1:[2,1]},{6:[2,2]},{6:[2,198]},{27:[1,64],28:[1,65],83:63},{6:[2,40],192:[1,66]},o($Vc,[2,257],{96:67,291:[1,68]}),o($Vd,[2,263],{99:69,291:[1,70]}),o($Ve,[2,268],{102:71,291:[1,72]}),{106:73,107:[2,270],291:[1,74]},{38:$Vf,109:75},{38:$Vf,109:77},{38:$Vf,109:78},{113:79,121:$Vg},{117:81,120:$Vh},o($Vi,[2,261]),o($Vi,[2,262]),o($Vj,[2,265]),o($Vj,[2,266]),o($Vj,[2,267]),{120:[2,279],121:[2,273]},{12:$V7,15:$V8,52:83,281:$Va},o($V0,[2,3]),{12:[1,84]},{19:85,37:$Vk,38:$Vl,49:86,50:$Vm,53:87},o($V5,[2,211],{35:90}),{37:[1,91],49:92,50:$Vm},o($Vn,[2,335],{168:93,169:94,170:95,40:[2,333]}),o($Vo,[2,223],{44:96}),o($Vo,[2,221],{52:54,288:97,12:$V7,15:$V8,27:$V9,281:$Va}),o($Vo,[2,222]),o($Vp,[2,219]),o($Vp,[2,217]),o($Vp,[2,218]),o($Vq,[2,184]),o($Vq,[2,185]),o($Vq,[2,186]),{19:98,37:$Vk,38:$Vl,49:99,50:$Vm,53:87},{25:100,26:103,27:$Vr,28:$Vs,286:101,287:[1,102]},o($Vb,[2,206]),o($Vb,[2,203]),o($Vb,[2,204]),o($Vt,[2,33]),{38:[1,106]},o($Vu,[2,249],{85:107}),o($V1,[2,256]),{12:$V7,15:$V8,52:108,281:$Va},o($Vc,[2,258]),{100:109,107:[1,110],129:[1,112],131:111,290:[1,113],297:[1,114]},o($Vd,[2,264]),o($Vc,$Vv,{103:115,130:117,107:$Vw,129:$Vx}),o($Ve,[2,269]),{107:[1,119]},{107:[2,271]},o($Vy,[2,45]),o($Vn,$Vz,{132:120,139:121,140:122,40:$VA,107:$VA}),o($Vy,[2,46]),o($Vy,[2,47]),o($VB,[2,274],{114:123,117:124,120:$Vh}),{38:$Vf,109:125},o($VB,[2,280],{118:126,113:127,121:$Vg}),{38:$Vf,109:128},o([120,121],[2,53]),o($V0,[2,4]),o($VC,$VD,{20:129,55:130,59:131,60:$VE}),o($V5,[2,200]),{38:$VF,54:133},o($Vc,[2,229],{51:135,290:[1,136]}),{38:[2,232]},{19:137,37:$Vk,38:$Vl,49:138,50:$Vm,53:87},{38:[1,139]},o($V6,[2,214]),{40:[1,140]},{40:[2,334]},{12:$V7,15:$V8,27:$VG,28:$VH,52:145,79:$VI,88:146,141:141,163:$VJ,172:142,174:143,210:$VK,213:$VL,214:$VM,231:156,233:157,264:152,267:$VN,268:$VO,269:$VP,270:$VQ,271:$VR,272:$VS,273:$VT,274:$VU,275:$VV,276:$VW,277:$VX,278:$VY,279:$VZ,280:$V_,281:$Va},o($V$,[2,225],{53:87,45:170,49:171,19:172,37:$Vk,38:$Vl,50:$Vm}),o($Vp,[2,220]),o($VC,$VD,{55:130,59:131,20:173,60:$VE}),o($V5,[2,228]),o($V5,[2,7]),o($V5,[2,209],{26:174,27:$Vr,28:$Vs}),o($V5,[2,210]),o($V01,[2,207]),o($V01,[2,8]),o($V11,$V21,{29:175,215:176,219:177,223:178,227:179,235:180,239:181,203:$V31,241:$V41,305:$V51}),o($V61,[2,247],{84:185}),{27:[1,187],31:[1,186]},o($Vy,[2,259],{97:188,127:189,128:[1,190]}),o($Vy,[2,42]),{12:$V7,15:$V8,52:191,281:$Va},o($Vy,[2,58]),o($Vy,[2,288]),o($Vy,[2,289]),o($Vy,[2,290]),{104:[1,192]},o($V71,[2,55]),{12:$V7,15:$V8,52:193,281:$Va},o($Vc,[2,287]),{12:$V7,15:$V8,52:194,281:$Va},o($V81,[2,293],{133:195}),o($V81,[2,292]),{12:$V7,15:$V8,27:$VG,28:$VH,52:145,79:$VI,88:146,141:196,163:$VJ,172:142,174:143,210:$VK,213:$VL,214:$VM,231:156,233:157,264:152,267:$VN,268:$VO,269:$VP,270:$VQ,271:$VR,272:$VS,273:$VT,274:$VU,275:$VV,276:$VW,277:$VX,278:$VY,279:$VZ,280:$V_,281:$Va},o($VB,[2,276],{115:197}),o($VB,[2,275]),o([37,120,123],[2,51]),o($VB,[2,282],{119:198}),o($VB,[2,281]),o([37,121,123],[2,50]),o($V4,[2,5]),o($V91,[2,235],{56:199,66:200,67:[1,201]}),o($VC,[2,234]),{61:[1,202]},o([6,40,60,67,70,78,80,82],[2,15]),o($Vn,$Va1,{21:203,143:204,17:205,144:206,150:207,151:208,23:$V2,38:$Vb1,40:$Vb1,82:$Vb1,107:$Vb1,155:$Vb1,156:$Vb1,158:$Vb1,161:$Vb1,162:$Vb1}),{12:$V7,15:$V8,52:209,281:$Va},o($Vc,[2,230]),o($VC,$VD,{55:130,59:131,20:210,60:$VE}),o($V5,[2,212]),o($Vn,$Vz,{140:122,39:211,139:212,40:[2,215]}),o($V5,[2,82]),{40:[2,337],171:213,298:[1,214]},o($Vc1,$Vd1,{173:215,177:216}),o($Vc1,$Vd1,{177:216,175:217,176:218,173:219,40:$Ve1,107:$Ve1,298:$Ve1}),o($Vf1,[2,121]),o($Vf1,[2,122]),o($Vf1,[2,123]),o($Vf1,[2,124]),o($Vf1,[2,125]),o($Vf1,[2,126]),{12:$V7,15:$V8,27:$VG,28:$VH,52:145,79:$VI,88:146,163:$VJ,172:222,174:223,183:221,209:220,210:$VK,213:$VL,214:$VM,231:156,233:157,264:152,267:$VN,268:$VO,269:$VP,270:$VQ,271:$VR,272:$VS,273:$VT,274:$VU,275:$VV,276:$VW,277:$VX,278:$VY,279:$VZ,280:$V_,281:$Va},o($Vc1,$Vd1,{177:216,173:224}),o($Vg1,[2,164],{265:[1,225],266:[1,226]}),o($Vg1,[2,167]),o($Vg1,[2,168]),o($Vg1,[2,169]),o($Vg1,[2,170]),o($Vg1,[2,171]),o($Vg1,[2,172]),o($Vg1,[2,173]),o($Vh1,[2,174]),o($Vh1,[2,175]),o($Vh1,[2,176]),o($Vh1,[2,177]),o($Vg1,[2,178]),o($Vg1,[2,179]),o($Vg1,[2,180]),o($Vg1,[2,181]),o($Vg1,[2,182]),o($Vg1,[2,183]),o($VC,$VD,{55:130,59:131,20:227,60:$VE}),o($Vo,[2,224]),o($V$,[2,226]),o($V4,[2,13]),o($V01,[2,208]),{30:[1,228]},o($Vi1,[2,376],{216:229}),o($Vj1,[2,378],{220:230}),o($Vj1,[2,131],{224:231,225:232,226:[2,386],263:[1,233],306:[1,234],307:[1,235],308:[1,236],309:[1,237],310:[1,238],311:[1,239]}),o($Vk1,[2,388],{228:240}),o($Vl1,[2,396],{236:241}),{12:$V7,15:$V8,27:$Vm1,28:$Vn1,52:245,64:244,65:246,74:243,79:$VI,88:247,231:156,233:157,240:242,242:250,243:$Vo1,244:$Vp1,245:$Vq1,247:$Vr1,248:255,249:$Vs1,250:$Vt1,251:258,252:$Vu1,253:$Vv1,256:$Vw1,258:$Vx1,264:152,267:$VN,268:$VO,269:$VP,270:$VQ,271:$VR,272:$VS,273:$VT,274:$VU,275:$VV,276:$VW,277:$VX,278:$VY,279:$VZ,280:$V_,281:$Va,311:$Vy1,312:$Vz1,313:$VA1,314:$VB1,315:$VC1,316:$VD1},{12:$V7,15:$V8,27:$Vm1,28:$Vn1,52:245,64:244,65:246,74:243,79:$VI,88:247,231:156,233:157,240:268,242:250,243:$Vo1,244:$Vp1,245:$Vq1,247:$Vr1,248:255,249:$Vs1,250:$Vt1,251:258,252:$Vu1,253:$Vv1,256:$Vw1,258:$Vx1,264:152,267:$VN,268:$VO,269:$VP,270:$VQ,271:$VR,272:$VS,273:$VT,274:$VU,275:$VV,276:$VW,277:$VX,278:$VY,279:$VZ,280:$V_,281:$Va,311:$Vy1,312:$Vz1,313:$VA1,314:$VB1,315:$VC1,316:$VD1},{12:$V7,15:$V8,27:$Vm1,28:$Vn1,52:245,64:244,65:246,74:243,79:$VI,88:247,231:156,233:157,240:269,242:250,243:$Vo1,244:$Vp1,245:$Vq1,247:$Vr1,248:255,249:$Vs1,250:$Vt1,251:258,252:$Vu1,253:$Vv1,256:$Vw1,258:$Vx1,264:152,267:$VN,268:$VO,269:$VP,270:$VQ,271:$VR,272:$VS,273:$VT,274:$VU,275:$VV,276:$VW,277:$VX,278:$VY,279:$VZ,280:$V_,281:$Va,311:$Vy1,312:$Vz1,313:$VA1,314:$VB1,315:$VC1,316:$VD1},o($V11,[2,401]),{12:$V7,15:$V8,40:[1,270],52:272,79:$VI,87:271,88:273,89:$VE1,231:156,233:157,264:152,267:$VN,268:$VO,269:$VP,270:$VQ,271:$VR,272:$VS,273:$VT,274:$VU,275:$VV,276:$VW,277:$VX,278:$VY,279:$VZ,280:$V_,281:$Va},{38:[1,275]},o($Vu,[2,250]),o($Vy,[2,41]),o($Vy,[2,260]),{107:[1,276]},o($Vy,[2,57]),o($Vc,$Vv,{130:117,103:277,107:$Vw,129:$Vx}),o($V71,[2,56]),o($Vy,[2,44]),{40:[1,278],107:[1,280],134:279},o($V81,[2,305],{142:281,298:[1,282]}),{37:[1,283],122:284,123:$VF1},{37:[1,286],122:287,123:$VF1},o($VG1,[2,237],{57:288,69:289,70:[1,290]}),o($V91,[2,236]),{12:$V7,15:$V8,28:$Vn1,52:296,64:294,65:295,68:291,74:293,76:292,242:250,243:$Vo1,244:$Vp1,245:$Vq1,247:$Vr1,248:255,249:$Vs1,250:$Vt1,251:258,252:$Vu1,253:$Vv1,256:$Vw1,258:$Vx1,281:$Va,311:$Vy1,312:$Vz1,313:$VA1,314:$VB1,315:$VC1,316:$VD1},{12:$V7,15:$V8,27:$VH1,28:$VI1,52:296,62:297,63:298,64:299,65:300,242:250,243:$Vo1,244:$Vp1,245:$Vq1,247:$Vr1,248:255,249:$Vs1,250:$Vt1,251:258,252:$Vu1,253:$Vv1,256:$Vw1,258:$Vx1,281:$Va,311:$Vy1,312:$Vz1,313:$VA1,314:$VB1,315:$VC1,316:$VD1},{40:[1,303]},{40:[1,304]},{19:305,37:$Vk,38:$Vl,53:87},o($VJ1,[2,309],{145:306}),o($VJ1,[2,308]),{12:$V7,15:$V8,27:$VG,28:$VK1,52:145,79:$VI,88:146,152:307,163:$VJ,172:308,185:309,210:$VL1,213:$VL,214:$VM,231:156,233:157,264:152,267:$VN,268:$VO,269:$VP,270:$VQ,271:$VR,272:$VS,273:$VT,274:$VU,275:$VV,276:$VW,277:$VX,278:$VY,279:$VZ,280:$V_,281:$Va},o($Vo,[2,14]),o($V4,[2,10]),{40:[1,312]},{40:[2,216]},{40:[2,83]},o($Vn,[2,336],{40:[2,338]}),o($VM1,[2,84]),{12:$V7,15:$V8,27:[1,315],52:316,178:313,179:314,181:[1,317],281:$Va},o($VM1,[2,85]),o($VM1,[2,86]),o($VM1,[2,340]),{12:$V7,15:$V8,27:$VG,28:$VH,31:[1,318],52:145,79:$VI,88:146,163:$VJ,172:222,174:223,183:319,210:$VK,213:$VL,214:$VM,231:156,233:157,264:152,267:$VN,268:$VO,269:$VP,270:$VQ,271:$VR,272:$VS,273:$VT,274:$VU,275:$VV,276:$VW,277:$VX,278:$VY,279:$VZ,280:$V_,281:$Va},o($VN1,[2,372]),o($VO1,[2,117]),o($VO1,[2,118]),{211:[1,320]},o($Vg1,[2,165]),{12:$V7,15:$V8,52:321,281:$Va},o($V4,[2,12]),{27:[1,322]},o([30,31,192,246],[2,127],{217:323,218:[1,324]}),o($Vi1,[2,129],{221:325,222:[1,326]}),o($V11,$V21,{227:179,235:180,239:181,223:327,203:$V31,241:$V41,305:$V51}),{226:[1,328]},o($VP1,[2,380]),o($VP1,[2,381]),o($VP1,[2,382]),o($VP1,[2,383]),o($VP1,[2,384]),o($VP1,[2,385]),{226:[2,387]},o([30,31,192,218,222,226,246,263,306,307,308,309,310,311],[2,134],{229:329,230:330,231:331,233:332,241:[1,334],275:$VV,276:$VW,277:$VX,278:$VY,279:$VZ,280:$V_,305:[1,333]}),o($Vk1,[2,138],{237:335,238:336,287:$VQ1,302:$VR1}),o($Vl1,[2,140]),o($Vl1,[2,143]),o($Vl1,[2,144]),o($Vl1,[2,145],{28:$VS1,163:$VT1}),o($Vl1,[2,146]),o($Vl1,[2,147]),o($Vl1,[2,148]),o($V11,$V21,{215:176,219:177,223:178,227:179,235:180,239:181,29:341,203:$V31,241:$V41,305:$V51}),o($VU1,[2,150]),{163:[1,342]},{28:[1,343]},{28:[1,344]},{28:[1,345]},{28:$VV1,163:$VW1,166:346},{28:[1,349]},{28:[1,351],163:[1,350]},{252:[1,352]},{28:[1,353]},{28:[1,354]},{28:[1,355]},o($VX1,[2,402]),o($VX1,[2,403]),o($VX1,[2,404]),o($VX1,[2,405]),o($VX1,[2,406]),{252:[2,408]},o($Vl1,[2,141]),o($Vl1,[2,142]),o($Vt,[2,34]),o($V61,[2,248]),o($VY1,[2,36]),o($VY1,[2,37]),o($VY1,[2,38]),o($VZ1,[2,251],{86:356}),{12:$V7,15:$V8,52:357,281:$Va},o($Vy,[2,43]),o([6,37,120,121,123,192],[2,59]),o($V81,[2,294]),{12:$V7,15:$V8,27:[1,359],52:360,135:358,281:$Va},o($V81,[2,61]),o($Vn,[2,304],{40:$V_1,107:$V_1}),{38:$VF,54:361},o($VB,[2,277]),o($Vc,[2,284],{124:362,290:[1,363]}),{38:$VF,54:364},o($VB,[2,283]),o($V$1,[2,239],{58:365,77:366,78:[1,367],80:[1,368]}),o($VG1,[2,238]),{61:[1,369]},o($V91,[2,23],{242:250,248:255,251:258,74:293,64:294,65:295,52:296,76:370,12:$V7,15:$V8,28:$Vn1,243:$Vo1,244:$Vp1,245:$Vq1,247:$Vr1,249:$Vs1,250:$Vt1,252:$Vu1,253:$Vv1,256:$Vw1,258:$Vx1,281:$Va,311:$Vy1,312:$Vz1,313:$VA1,314:$VB1,315:$VC1,316:$VD1}),o($V02,[2,243]),o($V12,[2,75]),o($V12,[2,76]),o($V12,[2,77]),{28:$VS1,163:$VT1},o($VC,[2,17],{242:250,248:255,251:258,52:296,64:299,65:300,63:371,12:$V7,15:$V8,27:$VH1,28:$VI1,243:$Vo1,244:$Vp1,245:$Vq1,247:$Vr1,249:$Vs1,250:$Vt1,252:$Vu1,253:$Vv1,256:$Vw1,258:$Vx1,281:$Va,311:$Vy1,312:$Vz1,313:$VA1,314:$VB1,315:$VC1,316:$VD1}),o($V22,[2,241]),o($V22,[2,18]),o($V22,[2,19]),o($V11,$V21,{215:176,219:177,223:178,227:179,235:180,239:181,29:372,203:$V31,241:$V41,305:$V51}),o($V22,[2,22]),o($V32,[2,62]),o($V32,[2,63]),o($VC,$VD,{55:130,59:131,20:373,60:$VE}),{38:[2,319],40:[2,64],81:383,82:$V3,107:[1,379],146:374,147:375,154:376,155:[1,377],156:[1,378],158:[1,380],161:[1,381],162:[1,382]},o($VJ1,[2,317],{153:384,298:[1,385]}),o($V42,$V52,{184:386,187:387,194:388,195:390,27:$V62}),o($V72,[2,347],{187:387,194:388,195:390,186:391,184:392,12:$V52,15:$V52,28:$V52,181:$V52,203:$V52,208:$V52,281:$V52,27:$V62}),{12:$V7,15:$V8,27:$VG,28:$VK1,52:145,79:$VI,88:146,163:$VJ,172:395,185:396,189:394,210:$VL1,212:393,213:$VL,214:$VM,231:156,233:157,264:152,267:$VN,268:$VO,269:$VP,270:$VQ,271:$VR,272:$VS,273:$VT,274:$VU,275:$VV,276:$VW,277:$VX,278:$VY,279:$VZ,280:$V_,281:$Va},o($V42,$V52,{187:387,194:388,195:390,184:397,27:$V62}),o($VC,$VD,{55:130,59:131,20:398,60:$VE}),o([40,107,211,298],[2,87],{300:399,192:[1,400]}),o($Vn,$V82,{180:401,182:402}),o($Vn,[2,89]),o($Vn,[2,90]),o($Vn,[2,91]),o($V92,[2,113]),o($VN1,[2,373]),o($V92,[2,114]),o($Vg1,[2,166]),{31:[1,403]},o($Vi1,[2,377]),o($V11,$V21,{219:177,223:178,227:179,235:180,239:181,215:404,203:$V31,241:$V41,305:$V51}),o($Vj1,[2,379]),o($V11,$V21,{223:178,227:179,235:180,239:181,219:405,203:$V31,241:$V41,305:$V51}),o($Vj1,[2,132]),{28:$VV1,163:$VW1,166:406},o($Vk1,[2,389]),o($V11,$V21,{235:180,239:181,227:407,203:$V31,241:$V41,305:$V51}),o($Vl1,[2,392],{232:408}),o($Vl1,[2,394],{234:409}),o($VP1,[2,390]),o($VP1,[2,391]),o($Vl1,[2,397]),o($V11,$V21,{239:181,235:410,203:$V31,241:$V41,305:$V51}),o($VP1,[2,398]),o($VP1,[2,399]),o($VU1,[2,78]),o($VP1,[2,327],{164:411,284:[1,412]}),{31:[1,413]},o($VU1,[2,151]),o($V11,$V21,{215:176,219:177,223:178,227:179,235:180,239:181,29:414,203:$V31,241:$V41,305:$V51}),o($V11,$V21,{215:176,219:177,223:178,227:179,235:180,239:181,29:415,203:$V31,241:$V41,305:$V51}),o($V11,$V21,{215:176,219:177,223:178,227:179,235:180,239:181,29:416,203:$V31,241:$V41,305:$V51}),o($VU1,[2,155]),o($VU1,[2,80]),o($VP1,[2,331],{167:417}),{27:[1,418]},o($VU1,[2,157]),o($V11,$V21,{215:176,219:177,223:178,227:179,235:180,239:181,29:419,203:$V31,241:$V41,305:$V51}),{38:$VF,54:420},o($Va2,[2,409],{254:421,284:[1,422]}),o($VP1,[2,413],{257:423,284:[1,424]}),o($VP1,[2,415],{259:425,284:[1,426]}),{28:[1,429],40:[1,427],90:428},o($Vy,[2,54]),{38:[1,430]},{38:[2,295]},{38:[2,296]},o($Vy,[2,48]),{12:$V7,15:$V8,52:431,281:$Va},o($Vc,[2,285]),o($Vy,[2,49]),o($V$1,[2,16]),o($V$1,[2,240]),{79:[1,432]},{79:[1,433]},{12:$V7,15:$V8,27:$Vb2,28:$Vn1,52:296,64:294,65:295,71:434,72:435,73:$Vc2,74:293,75:$Vd2,76:438,242:250,243:$Vo1,244:$Vp1,245:$Vq1,247:$Vr1,248:255,249:$Vs1,250:$Vt1,251:258,252:$Vu1,253:$Vv1,256:$Vw1,258:$Vx1,281:$Va,311:$Vy1,312:$Vz1,313:$VA1,314:$VB1,315:$VC1,316:$VD1},o($V02,[2,244]),o($V22,[2,242]),{30:[1,441],31:[1,440]},{22:442,40:[2,201],81:443,82:$V3},o($VJ1,[2,310]),o($Ve2,[2,311],{148:444,298:[1,445]}),{38:$VF,54:446},{38:$VF,54:447},{38:$VF,54:448},{12:$V7,15:$V8,27:[1,450],52:451,157:449,281:$Va},o($Vf2,[2,323],{159:452,291:[1,453]}),{12:$V7,15:$V8,28:$Vn1,52:296,64:294,65:295,74:293,76:454,242:250,243:$Vo1,244:$Vp1,245:$Vq1,247:$Vr1,248:255,249:$Vs1,250:$Vt1,251:258,252:$Vu1,253:$Vv1,256:$Vw1,258:$Vx1,281:$Va,311:$Vy1,312:$Vz1,313:$VA1,314:$VB1,315:$VC1,316:$VD1},{28:[1,455]},o($Vg2,[2,74]),o($VJ1,[2,66]),o($Vn,[2,316],{38:$Vh2,40:$Vh2,82:$Vh2,107:$Vh2,155:$Vh2,156:$Vh2,158:$Vh2,161:$Vh2,162:$Vh2}),o($V72,[2,93]),o($Vn,[2,351],{188:456}),o($Vn,[2,349]),o($Vn,[2,350]),o($V42,[2,359],{196:457,197:458}),o($V72,[2,94]),o($V72,[2,348]),{12:$V7,15:$V8,27:$VG,28:$VK1,31:[1,459],52:145,79:$VI,88:146,163:$VJ,172:395,185:396,189:460,210:$VL1,213:$VL,214:$VM,231:156,233:157,264:152,267:$VN,268:$VO,269:$VP,270:$VQ,271:$VR,272:$VS,273:$VT,274:$VU,275:$VV,276:$VW,277:$VX,278:$VY,279:$VZ,280:$V_,281:$Va},o($VN1,[2,374]),o($VO1,[2,119]),o($VO1,[2,120]),{211:[1,461]},o($V4,[2,11]),o($Vc1,[2,344],{192:[1,462]}),o($Vi2,[2,341]),o([40,107,192,211,298],[2,88]),{12:$V7,15:$V8,27:$VG,28:$VH,52:145,79:$VI,88:146,163:$VJ,172:222,174:223,183:463,210:$VK,213:$VL,214:$VM,231:156,233:157,264:152,267:$VN,268:$VO,269:$VP,270:$VQ,271:$VR,272:$VS,273:$VT,274:$VU,275:$VV,276:$VW,277:$VX,278:$VY,279:$VZ,280:$V_,281:$Va},o($V01,[2,9]),o($Vi1,[2,128]),o($Vj1,[2,130]),o($Vj1,[2,133]),o($Vk1,[2,135]),o($Vk1,[2,136],{238:336,237:464,287:$VQ1,302:$VR1}),o($Vk1,[2,137],{238:336,237:465,287:$VQ1,302:$VR1}),o($Vl1,[2,139]),o($VP1,[2,329],{165:466}),o($VP1,[2,328]),o([6,12,15,27,28,30,31,38,40,70,73,75,78,79,80,82,107,155,156,158,161,162,163,192,210,213,214,218,222,226,241,243,244,245,246,247,249,250,252,253,256,258,263,267,268,269,270,271,272,273,274,275,276,277,278,279,280,281,287,298,302,305,306,307,308,309,310,311,312,313,314,315,316],[2,149]),{31:[1,467]},{246:[1,468]},{246:[1,469]},o($V11,$V21,{215:176,219:177,223:178,227:179,235:180,239:181,29:470,203:$V31,241:$V41,305:$V51}),{31:[1,471]},{31:[1,472]},o($VU1,[2,159]),o($V11,$V21,{215:176,219:177,223:178,227:179,235:180,239:181,255:473,29:475,203:$V31,241:$V41,287:[1,474],305:$V51}),o($Va2,[2,410]),o($V11,$V21,{215:176,219:177,223:178,227:179,235:180,239:181,29:476,203:$V31,241:$V41,305:$V51}),o($VP1,[2,414]),o($V11,$V21,{215:176,219:177,223:178,227:179,235:180,239:181,29:477,203:$V31,241:$V41,305:$V51}),o($VP1,[2,416]),o($Vt,[2,35]),o($VZ1,[2,252]),o($Vj2,[2,253],{91:478}),o($Vn,$Vz,{140:122,136:479,139:480,40:[2,297]}),o($VB,[2,52]),o($V$1,[2,29],{80:[1,481]}),o($V$1,[2,30],{78:[1,482]}),o($VG1,[2,24],{242:250,248:255,251:258,74:293,64:294,65:295,52:296,76:438,72:483,12:$V7,15:$V8,27:$Vb2,28:$Vn1,73:$Vc2,75:$Vd2,243:$Vo1,244:$Vp1,245:$Vq1,247:$Vr1,249:$Vs1,250:$Vt1,252:$Vu1,253:$Vv1,256:$Vw1,258:$Vx1,281:$Va,311:$Vy1,312:$Vz1,313:$VA1,314:$VB1,315:$VC1,316:$VD1}),o($Vk2,[2,245]),{28:$Vn1,74:484},{28:$Vn1,74:485},o($Vk2,[2,27]),o($Vk2,[2,28]),o($V22,[2,20]),{27:[1,486]},{40:[2,6]},{40:[2,202]},o($Vn,$Va1,{151:208,149:487,150:488,38:$Vl2,40:$Vl2,82:$Vl2,107:$Vl2,155:$Vl2,156:$Vl2,158:$Vl2,161:$Vl2,162:$Vl2}),o($Ve2,[2,312]),o($Vg2,[2,67],{299:[1,489]}),o($Vg2,[2,68]),o($Vg2,[2,69]),{38:$VF,54:490},{38:[2,321]},{38:[2,322]},{12:$V7,15:$V8,27:[1,492],52:493,160:491,281:$Va},o($Vf2,[2,324]),o($Vg2,[2,72]),o($V11,$V21,{215:176,219:177,223:178,227:179,235:180,239:181,29:494,203:$V31,241:$V41,305:$V51}),{12:$V7,15:$V8,27:$VG,28:$VK1,52:145,79:$VI,88:146,163:$VJ,172:395,185:396,189:495,210:$VL1,213:$VL,214:$VM,231:156,233:157,264:152,267:$VN,268:$VO,269:$VP,270:$VQ,271:$VR,272:$VS,273:$VT,274:$VU,275:$VV,276:$VW,277:$VX,278:$VY,279:$VZ,280:$V_,281:$Va},o($VN1,[2,98],{301:[1,496]}),o($Vm2,[2,366],{198:497,202:498,208:[1,499]}),o($Vf1,[2,115]),o($VN1,[2,375]),o($Vf1,[2,116]),o($Vi2,[2,342]),o($Vn2,[2,92],{246:[1,500]}),o($Vl1,[2,393]),o($Vl1,[2,395]),o($V11,$V21,{215:176,219:177,223:178,227:179,235:180,239:181,29:501,203:$V31,241:$V41,305:$V51}),o($VU1,[2,152]),o($V11,$V21,{215:176,219:177,223:178,227:179,235:180,239:181,29:502,203:$V31,241:$V41,305:$V51}),o($V11,$V21,{215:176,219:177,223:178,227:179,235:180,239:181,29:503,203:$V31,241:$V41,305:$V51}),{31:[1,504],246:[1,505]},o($VU1,[2,156]),o($VU1,[2,158]),{31:[1,506]},{31:[2,411]},{31:[2,412]},{31:[1,507]},{31:[2,417],192:[1,510],260:508,261:509},{12:$V7,15:$V8,31:[1,511],52:272,79:$VI,87:512,88:273,89:$VE1,231:156,233:157,264:152,267:$VN,268:$VO,269:$VP,270:$VQ,271:$VR,272:$VS,273:$VT,274:$VU,275:$VV,276:$VW,277:$VX,278:$VY,279:$VZ,280:$V_,281:$Va},{40:[1,513]},{40:[2,298]},{79:[1,514]},{79:[1,515]},o($Vk2,[2,246]),o($Vk2,[2,25]),o($Vk2,[2,26]),{31:[1,516]},o($VJ1,[2,65]),o($VJ1,[2,314]),{38:[2,320]},o($Vg2,[2,70]),{38:$VF,54:517},{38:[2,325]},{38:[2,326]},{30:[1,518]},o($Vn2,[2,353],{190:519,246:[1,520]}),o($V42,[2,358]),o([12,15,27,28,31,79,163,210,213,214,267,268,269,270,271,272,273,274,275,276,277,278,279,280,281,301],[2,99],{302:[1,521]}),{12:$V7,15:$V8,28:[1,527],52:524,181:[1,525],199:522,200:523,203:[1,526],281:$Va},o($Vm2,[2,367]),o($Vn,[2,346]),{31:[1,528],246:[1,529]},{31:[1,530]},{246:[1,531]},o($VU1,[2,81]),o($VP1,[2,332]),o($VU1,[2,160]),o($VU1,[2,161]),{31:[1,532]},{31:[2,418]},{262:[1,533]},o($VZ1,[2,39]),o($Vj2,[2,254]),o($Vo2,[2,299],{137:534,298:[1,535]}),o($V$1,[2,31]),o($V$1,[2,32]),o($V22,[2,21]),o($Vg2,[2,71]),{27:[1,536]},o([38,40,82,107,155,156,158,161,162,211,298],[2,95],{191:537,192:[1,538]}),o($Vn,[2,352]),o($V42,[2,360]),o($Vp2,[2,101]),o($Vp2,[2,364],{201:539,303:540,287:[1,542],304:[1,541],305:[1,543]}),o($Vq2,[2,102]),o($Vq2,[2,103]),{12:$V7,15:$V8,28:[1,547],52:548,163:[1,546],181:$Vr2,204:544,205:545,208:$Vs2,281:$Va},o($V42,$V52,{195:390,194:551}),o($VU1,[2,79]),o($VP1,[2,330]),o($VU1,[2,153]),o($V11,$V21,{215:176,219:177,223:178,227:179,235:180,239:181,29:552,203:$V31,241:$V41,305:$V51}),o($VU1,[2,162]),{263:[1,553]},o($Vn,$Vz,{140:122,138:554,139:555,40:$Vt2,107:$Vt2}),o($Vo2,[2,300]),{31:[1,556]},o($Vn2,[2,354]),o($Vn2,[2,96],{195:390,193:557,194:558,12:$V52,15:$V52,28:$V52,181:$V52,203:$V52,208:$V52,281:$V52,27:[1,559]}),o($Vp2,[2,100]),o($Vp2,[2,365]),o($Vp2,[2,361]),o($Vp2,[2,362]),o($Vp2,[2,363]),o($Vq2,[2,104]),o($Vq2,[2,106]),o($Vq2,[2,107]),o($Vu2,[2,368],{206:560}),o($Vq2,[2,109]),o($Vq2,[2,110]),{12:$V7,15:$V8,52:561,181:[1,562],281:$Va},{31:[1,563]},{31:[1,564]},{264:565,271:$VR,272:$VS,273:$VT,274:$VU},o($V81,[2,60]),o($V81,[2,302]),o($Vg2,[2,73]),o($Vn,$V82,{182:402,180:566}),o($Vn,[2,355]),o($Vn,[2,356]),{12:$V7,15:$V8,31:[2,370],52:548,181:$Vr2,205:568,207:567,208:$Vs2,281:$Va},o($Vq2,[2,111]),o($Vq2,[2,112]),o($Vq2,[2,105]),o($VU1,[2,154]),{31:[2,163]},o($Vn2,[2,97]),{31:[1,569]},{31:[2,371],301:[1,570]},o($Vq2,[2,108]),o($Vu2,[2,369])],
defaultActions: {5:[2,191],6:[2,192],22:[2,1],23:[2,2],24:[2,198],74:[2,271],89:[2,232],94:[2,334],212:[2,216],213:[2,83],239:[2,387],267:[2,408],359:[2,295],360:[2,296],442:[2,6],443:[2,202],450:[2,321],451:[2,322],474:[2,411],475:[2,412],480:[2,298],489:[2,320],492:[2,325],493:[2,326],509:[2,418],565:[2,163]},
parseError: function parseError(str, hash) {
    if (hash.recoverable) {
        this.trace(str);
    } else {
        function _parseError (msg, hash) {
            this.message = msg;
            this.hash = hash;
        }
        _parseError.prototype = new Error();

        throw new _parseError(str, hash);
    }
},
parse: function parse(input) {
    var self = this, stack = [0], tstack = [], vstack = [null], lstack = [], table = this.table, yytext = '', yylineno = 0, yyleng = 0, recovering = 0, TERROR = 2, EOF = 1;
    var args = lstack.slice.call(arguments, 1);
    var lexer = Object.create(this.lexer);
    var sharedState = { yy: {} };
    for (var k in this.yy) {
        if (Object.prototype.hasOwnProperty.call(this.yy, k)) {
            sharedState.yy[k] = this.yy[k];
        }
    }
    lexer.setInput(input, sharedState.yy);
    sharedState.yy.lexer = lexer;
    sharedState.yy.parser = this;
    if (typeof lexer.yylloc == 'undefined') {
        lexer.yylloc = {};
    }
    var yyloc = lexer.yylloc;
    lstack.push(yyloc);
    var ranges = lexer.options && lexer.options.ranges;
    if (typeof sharedState.yy.parseError === 'function') {
        this.parseError = sharedState.yy.parseError;
    } else {
        this.parseError = Object.getPrototypeOf(this).parseError;
    }
    function popStack(n) {
        stack.length = stack.length - 2 * n;
        vstack.length = vstack.length - n;
        lstack.length = lstack.length - n;
    }
    _token_stack:
        var lex = function () {
            var token;
            token = lexer.lex() || EOF;
            if (typeof token !== 'number') {
                token = self.symbols_[token] || token;
            }
            return token;
        };
    var symbol, preErrorSymbol, state, action, a, r, yyval = {}, p, len, newState, expected;
    while (true) {
        state = stack[stack.length - 1];
        if (this.defaultActions[state]) {
            action = this.defaultActions[state];
        } else {
            if (symbol === null || typeof symbol == 'undefined') {
                symbol = lex();
            }
            action = table[state] && table[state][symbol];
        }
                    if (typeof action === 'undefined' || !action.length || !action[0]) {
                var errStr = '';
                expected = [];
                for (p in table[state]) {
                    if (this.terminals_[p] && p > TERROR) {
                        expected.push('\'' + this.terminals_[p] + '\'');
                    }
                }
                if (lexer.showPosition) {
                    errStr = 'Parse error on line ' + (yylineno + 1) + ':\n' + lexer.showPosition() + '\nExpecting ' + expected.join(', ') + ', got \'' + (this.terminals_[symbol] || symbol) + '\'';
                } else {
                    errStr = 'Parse error on line ' + (yylineno + 1) + ': Unexpected ' + (symbol == EOF ? 'end of input' : '\'' + (this.terminals_[symbol] || symbol) + '\'');
                }
                this.parseError(errStr, {
                    text: lexer.match,
                    token: this.terminals_[symbol] || symbol,
                    line: lexer.yylineno,
                    loc: yyloc,
                    expected: expected
                });
            }
        if (action[0] instanceof Array && action.length > 1) {
            throw new Error('Parse Error: multiple actions possible at state: ' + state + ', token: ' + symbol);
        }
        switch (action[0]) {
        case 1:
            stack.push(symbol);
            vstack.push(lexer.yytext);
            lstack.push(lexer.yylloc);
            stack.push(action[1]);
            symbol = null;
            if (!preErrorSymbol) {
                yyleng = lexer.yyleng;
                yytext = lexer.yytext;
                yylineno = lexer.yylineno;
                yyloc = lexer.yylloc;
                if (recovering > 0) {
                    recovering--;
                }
            } else {
                symbol = preErrorSymbol;
                preErrorSymbol = null;
            }
            break;
        case 2:
            len = this.productions_[action[1]][1];
            yyval.$ = vstack[vstack.length - len];
            yyval._$ = {
                first_line: lstack[lstack.length - (len || 1)].first_line,
                last_line: lstack[lstack.length - 1].last_line,
                first_column: lstack[lstack.length - (len || 1)].first_column,
                last_column: lstack[lstack.length - 1].last_column
            };
            if (ranges) {
                yyval._$.range = [
                    lstack[lstack.length - (len || 1)].range[0],
                    lstack[lstack.length - 1].range[1]
                ];
            }
            r = this.performAction.apply(yyval, [
                yytext,
                yyleng,
                yylineno,
                sharedState.yy,
                action[1],
                vstack,
                lstack
            ].concat(args));
            if (typeof r !== 'undefined') {
                return r;
            }
            if (len) {
                stack = stack.slice(0, -1 * len * 2);
                vstack = vstack.slice(0, -1 * len);
                lstack = lstack.slice(0, -1 * len);
            }
            stack.push(this.productions_[action[1]][0]);
            vstack.push(yyval.$);
            lstack.push(yyval._$);
            newState = table[stack[stack.length - 2]][stack[stack.length - 1]];
            stack.push(newState);
            break;
        case 3:
            return true;
        }
    }
    return true;
}};

  /*
    SPARQL parser in the Jison parser generator format.
  */

  // Common namespaces and entities
  var RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
      RDF_TYPE  = RDF + 'type',
      RDF_FIRST = RDF + 'first',
      RDF_REST  = RDF + 'rest',
      RDF_NIL   = RDF + 'nil',
      XSD = 'http://www.w3.org/2001/XMLSchema#',
      XSD_INTEGER  = XSD + 'integer',
      XSD_DECIMAL  = XSD + 'decimal',
      XSD_DOUBLE   = XSD + 'double',
      XSD_BOOLEAN  = XSD + 'boolean',
      XSD_TRUE =  '"true"^^'  + XSD_BOOLEAN,
      XSD_FALSE = '"false"^^' + XSD_BOOLEAN;

  var base = '', basePath = '', baseRoot = '';

  // Returns a lowercase version of the given string
  function lowercase(string) {
    return string.toLowerCase();
  }

  // Appends the item to the array and returns the array
  function appendTo(array, item) {
    return array.push(item), array;
  }

  // Appends the items to the array and returns the array
  function appendAllTo(array, items) {
    return array.push.apply(array, items), array;
  }

  // Extends a base object with properties of other objects
  function extend(base) {
    if (!base) base = {};
    for (var i = 1, l = arguments.length, arg; i < l && (arg = arguments[i] || {}); i++)
      for (var name in arg)
        base[name] = arg[name];
    return base;
  }

  // Creates an array that contains all items of the given arrays
  function unionAll() {
    var union = [];
    for (var i = 0, l = arguments.length; i < l; i++)
      union = union.concat.apply(union, arguments[i]);
    return union;
  }

  // Resolves an IRI against a base path
  function resolveIRI(iri) {
    // Strip off possible angular brackets
    if (iri[0] === '<')
      iri = iri.substring(1, iri.length - 1);
    // Return absolute IRIs unmodified
    if (/^[a-z]+:/.test(iri))
      return iri;
    if (!Parser.base)
      throw new Error('Cannot resolve relative IRI ' + iri + ' because no base IRI was set.');
    if (!base) {
      base = Parser.base;
      basePath = base.replace(/[^\/:]*$/, '');
      baseRoot = base.match(/^(?:[a-z]+:\/*)?[^\/]*/)[0];
    }
    switch (iri[0]) {
    // An empty relative IRI indicates the base IRI
    case undefined:
      return base;
    // Resolve relative fragment IRIs against the base IRI
    case '#':
      return base + iri;
    // Resolve relative query string IRIs by replacing the query string
    case '?':
      return base.replace(/(?:\?.*)?$/, iri);
    // Resolve root relative IRIs at the root of the base IRI
    case '/':
      return baseRoot + iri;
    // Resolve all other IRIs at the base IRI's path
    default:
      return basePath + iri;
    }
  }

  // If the item is a variable, ensures it starts with a question mark
  function toVar(variable) {
    if (variable) {
      var first = variable[0];
      if (first === '?') return variable;
      if (first === '$') return '?' + variable.substr(1);
    }
    return variable;
  }

  // Creates an operation with the given name and arguments
  function operation(operatorName, args) {
    return { type: 'operation', operator: operatorName, args: args || [] };
  }

  // Creates an expression with the given type and attributes
  function expression(expr, attr) {
    var expression = { expression: expr };
    if (attr)
      for (var a in attr)
        expression[a] = attr[a];
    return expression;
  }

  // Creates a path with the given type and items
  function path(type, items) {
    return { type: 'path', pathType: type, items: items };
  }

  // Transforms a list of operations types and arguments into a tree of operations
  function createOperationTree(initialExpression, operationList) {
    for (var i = 0, l = operationList.length, item; i < l && (item = operationList[i]); i++)
      initialExpression = operation(item[0], [initialExpression, item[1]]);
    return initialExpression;
  }

  // Group datasets by default and named
  function groupDatasets(fromClauses) {
    var defaults = [], named = [], l = fromClauses.length, fromClause;
    for (var i = 0; i < l && (fromClause = fromClauses[i]); i++)
      (fromClause.named ? named : defaults).push(fromClause.iri);
    return l ? { from: { default: defaults, named: named } } : null;
  }

  // Converts the number to a string
  function toInt(string) {
    return parseInt(string, 10);
  }

  // Transforms a possibly single group into its patterns
  function degroupSingle(group) {
    return group.type === 'group' && group.patterns.length === 1 ? group.patterns[0] : group;
  }

  // Creates a literal with the given value and type
  function createLiteral(value, type) {
    return '"' + value + '"^^' + type;
  }

  // Creates a triple with the given subject, predicate, and object
  function triple(subject, predicate, object) {
    var triple = {};
    if (subject   != null) triple.subject   = subject;
    if (predicate != null) triple.predicate = predicate;
    if (object    != null) triple.object    = object;
    return triple;
  }

  // Creates a new blank node identifier
  function blank() {
    return '_:b' + blankId++;
  };
  var blankId = 0;
  Parser._resetBlanks = function () { blankId = 0; }

  // Regular expression and replacement strings to escape strings
  var escapeSequence = /\\u([a-fA-F0-9]{4})|\\U([a-fA-F0-9]{8})|\\(.)/g,
      escapeReplacements = { '\\': '\\', "'": "'", '"': '"',
                             't': '\t', 'b': '\b', 'n': '\n', 'r': '\r', 'f': '\f' },
      fromCharCode = String.fromCharCode;

  // Translates escape codes in the string into their textual equivalent
  function unescapeString(string, trimLength) {
    string = string.substring(trimLength, string.length - trimLength);
    try {
      string = string.replace(escapeSequence, function (sequence, unicode4, unicode8, escapedChar) {
        var charCode;
        if (unicode4) {
          charCode = parseInt(unicode4, 16);
          if (isNaN(charCode)) throw new Error(); // can never happen (regex), but helps performance
          return fromCharCode(charCode);
        }
        else if (unicode8) {
          charCode = parseInt(unicode8, 16);
          if (isNaN(charCode)) throw new Error(); // can never happen (regex), but helps performance
          if (charCode < 0xFFFF) return fromCharCode(charCode);
          return fromCharCode(0xD800 + ((charCode -= 0x10000) >> 10), 0xDC00 + (charCode & 0x3FF));
        }
        else {
          var replacement = escapeReplacements[escapedChar];
          if (!replacement) throw new Error();
          return replacement;
        }
      });
    }
    catch (error) { return ''; }
    return '"' + string + '"';
  }

  // Creates a list, collecting its (possibly blank) items and triples associated with those items
  function createList(objects) {
    var list = blank(), head = list, listItems = [], listTriples, triples = [];
    objects.forEach(function (o) { listItems.push(o.entity); appendAllTo(triples, o.triples); });

    // Build an RDF list out of the items
    for (var i = 0, j = 0, l = listItems.length, listTriples = Array(l * 2); i < l;)
      listTriples[j++] = triple(head, RDF_FIRST, listItems[i]),
      listTriples[j++] = triple(head, RDF_REST,  head = ++i < l ? blank() : RDF_NIL);

    // Return the list's identifier, its triples, and the triples associated with its items
    return { entity: list, triples: appendAllTo(listTriples, triples) };
  }

  // Creates a blank node identifier, collecting triples with that blank node as subject
  function createAnonymousObject(propertyList) {
    var entity = blank();
    return {
      entity: entity,
      triples: propertyList.map(function (t) { return extend(triple(entity), t); })
    };
  }

  // Collects all (possibly blank) objects, and triples that have them as subject
  function objectListToTriples(predicate, objectList, otherTriples) {
    var objects = [], triples = [];
    objectList.forEach(function (l) {
      objects.push(triple(null, predicate, l.entity));
      appendAllTo(triples, l.triples);
    });
    return unionAll(objects, otherTriples || [], triples);
  }

  // Simplifies groups by merging adjacent BGPs
  function mergeAdjacentBGPs(groups) {
    var merged = [], currentBgp;
    for (var i = 0, group; group = groups[i]; i++) {
      switch (group.type) {
        // Add a BGP's triples to the current BGP
        case 'bgp':
          if (group.triples.length) {
            if (!currentBgp)
              appendTo(merged, currentBgp = group);
            else
              appendAllTo(currentBgp.triples, group.triples);
          }
          break;
        // All other groups break up a BGP
        default:
          // Only add the group if its pattern is non-empty
          if (!group.patterns || group.patterns.length > 0) {
            appendTo(merged, group);
            currentBgp = null;
          }
      }
    }
    return merged;
  }
/* generated by jison-lex 0.3.4 */
var lexer = (function(){
var lexer = ({

EOF:1,

parseError:function parseError(str, hash) {
        if (this.yy.parser) {
            this.yy.parser.parseError(str, hash);
        } else {
            throw new Error(str);
        }
    },

// resets the lexer, sets new input
setInput:function (input, yy) {
        this.yy = yy || this.yy || {};
        this._input = input;
        this._more = this._backtrack = this.done = false;
        this.yylineno = this.yyleng = 0;
        this.yytext = this.matched = this.match = '';
        this.conditionStack = ['INITIAL'];
        this.yylloc = {
            first_line: 1,
            first_column: 0,
            last_line: 1,
            last_column: 0
        };
        if (this.options.ranges) {
            this.yylloc.range = [0,0];
        }
        this.offset = 0;
        return this;
    },

// consumes and returns one char from the input
input:function () {
        var ch = this._input[0];
        this.yytext += ch;
        this.yyleng++;
        this.offset++;
        this.match += ch;
        this.matched += ch;
        var lines = ch.match(/(?:\r\n?|\n).*/g);
        if (lines) {
            this.yylineno++;
            this.yylloc.last_line++;
        } else {
            this.yylloc.last_column++;
        }
        if (this.options.ranges) {
            this.yylloc.range[1]++;
        }

        this._input = this._input.slice(1);
        return ch;
    },

// unshifts one char (or a string) into the input
unput:function (ch) {
        var len = ch.length;
        var lines = ch.split(/(?:\r\n?|\n)/g);

        this._input = ch + this._input;
        this.yytext = this.yytext.substr(0, this.yytext.length - len);
        //this.yyleng -= len;
        this.offset -= len;
        var oldLines = this.match.split(/(?:\r\n?|\n)/g);
        this.match = this.match.substr(0, this.match.length - 1);
        this.matched = this.matched.substr(0, this.matched.length - 1);

        if (lines.length - 1) {
            this.yylineno -= lines.length - 1;
        }
        var r = this.yylloc.range;

        this.yylloc = {
            first_line: this.yylloc.first_line,
            last_line: this.yylineno + 1,
            first_column: this.yylloc.first_column,
            last_column: lines ?
                (lines.length === oldLines.length ? this.yylloc.first_column : 0)
                 + oldLines[oldLines.length - lines.length].length - lines[0].length :
              this.yylloc.first_column - len
        };

        if (this.options.ranges) {
            this.yylloc.range = [r[0], r[0] + this.yyleng - len];
        }
        this.yyleng = this.yytext.length;
        return this;
    },

// When called from action, caches matched text and appends it on next action
more:function () {
        this._more = true;
        return this;
    },

// When called from action, signals the lexer that this rule fails to match the input, so the next matching rule (regex) should be tested instead.
reject:function () {
        if (this.options.backtrack_lexer) {
            this._backtrack = true;
        } else {
            return this.parseError('Lexical error on line ' + (this.yylineno + 1) + '. You can only invoke reject() in the lexer when the lexer is of the backtracking persuasion (options.backtrack_lexer = true).\n' + this.showPosition(), {
                text: "",
                token: null,
                line: this.yylineno
            });

        }
        return this;
    },

// retain first n characters of the match
less:function (n) {
        this.unput(this.match.slice(n));
    },

// displays already matched input, i.e. for error messages
pastInput:function () {
        var past = this.matched.substr(0, this.matched.length - this.match.length);
        return (past.length > 20 ? '...':'') + past.substr(-20).replace(/\n/g, "");
    },

// displays upcoming input, i.e. for error messages
upcomingInput:function () {
        var next = this.match;
        if (next.length < 20) {
            next += this._input.substr(0, 20-next.length);
        }
        return (next.substr(0,20) + (next.length > 20 ? '...' : '')).replace(/\n/g, "");
    },

// displays the character position where the lexing error occurred, i.e. for error messages
showPosition:function () {
        var pre = this.pastInput();
        var c = new Array(pre.length + 1).join("-");
        return pre + this.upcomingInput() + "\n" + c + "^";
    },

// test the lexed token: return FALSE when not a match, otherwise return token
test_match:function (match, indexed_rule) {
        var token,
            lines,
            backup;

        if (this.options.backtrack_lexer) {
            // save context
            backup = {
                yylineno: this.yylineno,
                yylloc: {
                    first_line: this.yylloc.first_line,
                    last_line: this.last_line,
                    first_column: this.yylloc.first_column,
                    last_column: this.yylloc.last_column
                },
                yytext: this.yytext,
                match: this.match,
                matches: this.matches,
                matched: this.matched,
                yyleng: this.yyleng,
                offset: this.offset,
                _more: this._more,
                _input: this._input,
                yy: this.yy,
                conditionStack: this.conditionStack.slice(0),
                done: this.done
            };
            if (this.options.ranges) {
                backup.yylloc.range = this.yylloc.range.slice(0);
            }
        }

        lines = match[0].match(/(?:\r\n?|\n).*/g);
        if (lines) {
            this.yylineno += lines.length;
        }
        this.yylloc = {
            first_line: this.yylloc.last_line,
            last_line: this.yylineno + 1,
            first_column: this.yylloc.last_column,
            last_column: lines ?
                         lines[lines.length - 1].length - lines[lines.length - 1].match(/\r?\n?/)[0].length :
                         this.yylloc.last_column + match[0].length
        };
        this.yytext += match[0];
        this.match += match[0];
        this.matches = match;
        this.yyleng = this.yytext.length;
        if (this.options.ranges) {
            this.yylloc.range = [this.offset, this.offset += this.yyleng];
        }
        this._more = false;
        this._backtrack = false;
        this._input = this._input.slice(match[0].length);
        this.matched += match[0];
        token = this.performAction.call(this, this.yy, this, indexed_rule, this.conditionStack[this.conditionStack.length - 1]);
        if (this.done && this._input) {
            this.done = false;
        }
        if (token) {
            return token;
        } else if (this._backtrack) {
            // recover context
            for (var k in backup) {
                this[k] = backup[k];
            }
            return false; // rule action called reject() implying the next rule should be tested instead.
        }
        return false;
    },

// return next match in input
next:function () {
        if (this.done) {
            return this.EOF;
        }
        if (!this._input) {
            this.done = true;
        }

        var token,
            match,
            tempMatch,
            index;
        if (!this._more) {
            this.yytext = '';
            this.match = '';
        }
        var rules = this._currentRules();
        for (var i = 0; i < rules.length; i++) {
            tempMatch = this._input.match(this.rules[rules[i]]);
            if (tempMatch && (!match || tempMatch[0].length > match[0].length)) {
                match = tempMatch;
                index = i;
                if (this.options.backtrack_lexer) {
                    token = this.test_match(tempMatch, rules[i]);
                    if (token !== false) {
                        return token;
                    } else if (this._backtrack) {
                        match = false;
                        continue; // rule action called reject() implying a rule MISmatch.
                    } else {
                        // else: this is a lexer rule which consumes input without producing a token (e.g. whitespace)
                        return false;
                    }
                } else if (!this.options.flex) {
                    break;
                }
            }
        }
        if (match) {
            token = this.test_match(match, rules[index]);
            if (token !== false) {
                return token;
            }
            // else: this is a lexer rule which consumes input without producing a token (e.g. whitespace)
            return false;
        }
        if (this._input === "") {
            return this.EOF;
        } else {
            return this.parseError('Lexical error on line ' + (this.yylineno + 1) + '. Unrecognized text.\n' + this.showPosition(), {
                text: "",
                token: null,
                line: this.yylineno
            });
        }
    },

// return next match that has a token
lex:function lex() {
        var r = this.next();
        if (r) {
            return r;
        } else {
            return this.lex();
        }
    },

// activates a new lexer condition state (pushes the new lexer condition state onto the condition stack)
begin:function begin(condition) {
        this.conditionStack.push(condition);
    },

// pop the previously active lexer condition state off the condition stack
popState:function popState() {
        var n = this.conditionStack.length - 1;
        if (n > 0) {
            return this.conditionStack.pop();
        } else {
            return this.conditionStack[0];
        }
    },

// produce the lexer rule set which is active for the currently active lexer condition state
_currentRules:function _currentRules() {
        if (this.conditionStack.length && this.conditionStack[this.conditionStack.length - 1]) {
            return this.conditions[this.conditionStack[this.conditionStack.length - 1]].rules;
        } else {
            return this.conditions["INITIAL"].rules;
        }
    },

// return the currently active lexer condition state; when an index argument is provided it produces the N-th previous condition state, if available
topState:function topState(n) {
        n = this.conditionStack.length - 1 - Math.abs(n || 0);
        if (n >= 0) {
            return this.conditionStack[n];
        } else {
            return "INITIAL";
        }
    },

// alias for begin(condition)
pushState:function pushState(condition) {
        this.begin(condition);
    },

// return the number of states currently on the stack
stateStackSize:function stateStackSize() {
        return this.conditionStack.length;
    },
options: {"flex":true,"case-insensitive":true},
performAction: function anonymous(yy,yy_,$avoiding_name_collisions,YY_START) {
var YYSTATE=YY_START;
switch($avoiding_name_collisions) {
case 0:/* ignore */
break;
case 1:return 11
break;
case 2:return 14
break;
case 3:return 23
break;
case 4:return 284
break;
case 5:return 285
break;
case 6:return 28
break;
case 7:return 30
break;
case 8:return 31
break;
case 9:return 287
break;
case 10:return 33
break;
case 11:return 37
break;
case 12:return 38
break;
case 13:return 40
break;
case 14:return 42
break;
case 15:return 47
break;
case 16:return 50
break;
case 17:return 290
break;
case 18:return 60
break;
case 19:return 61
break;
case 20:return 67
break;
case 21:return 70
break;
case 22:return 73
break;
case 23:return 75
break;
case 24:return 78
break;
case 25:return 80
break;
case 26:return 82
break;
case 27:return 192
break;
case 28:return 95
break;
case 29:return 291
break;
case 30:return 128
break;
case 31:return 292
break;
case 32:return 293
break;
case 33:return 105
break;
case 34:return 294
break;
case 35:return 104
break;
case 36:return 295
break;
case 37:return 296
break;
case 38:return 108
break;
case 39:return 110
break;
case 40:return 111
break;
case 41:return 126
break;
case 42:return 120
break;
case 43:return 121
break;
case 44:return 123
break;
case 45:return 129
break;
case 46:return 107
break;
case 47:return 297
break;
case 48:return 298
break;
case 49:return 155
break;
case 50:return 158
break;
case 51:return 162
break;
case 52:return 89
break;
case 53:return 156
break;
case 54:return 299
break;
case 55:return 161
break;
case 56:return 246
break;
case 57:return 181
break;
case 58:return 301
break;
case 59:return 302
break;
case 60:return 208
break;
case 61:return 304
break;
case 62:return 305
break;
case 63:return 203
break;
case 64:return 210
break;
case 65:return 211
break;
case 66:return 218
break;
case 67:return 222
break;
case 68:return 263
break;
case 69:return 306
break;
case 70:return 307
break;
case 71:return 308
break;
case 72:return 309
break;
case 73:return 310
break;
case 74:return 226
break;
case 75:return 311
break;
case 76:return 241
break;
case 77:return 249
break;
case 78:return 250
break;
case 79:return 243
break;
case 80:return 244
break;
case 81:return 245
break;
case 82:return 312
break;
case 83:return 313
break;
case 84:return 247
break;
case 85:return 315
break;
case 86:return 314
break;
case 87:return 316
break;
case 88:return 252
break;
case 89:return 253
break;
case 90:return 256
break;
case 91:return 258
break;
case 92:return 262
break;
case 93:return 266
break;
case 94:return 269
break;
case 95:return 270
break;
case 96:return 12
break;
case 97:return 15
break;
case 98:return 281
break;
case 99:return 213
break;
case 100:return 27
break;
case 101:return 265
break;
case 102:return 79
break;
case 103:return 267
break;
case 104:return 268
break;
case 105:return 275
break;
case 106:return 276
break;
case 107:return 277
break;
case 108:return 278
break;
case 109:return 279
break;
case 110:return 280
break;
case 111:return 'EXPONENT'
break;
case 112:return 271
break;
case 113:return 272
break;
case 114:return 273
break;
case 115:return 274
break;
case 116:return 163
break;
case 117:return 214
break;
case 118:return 6
break;
case 119:return 'INVALID'
break;
case 120:console.log(yy_.yytext);
break;
}
},
rules: [/^(?:\s+|#[^\n\r]*)/i,/^(?:BASE)/i,/^(?:PREFIX)/i,/^(?:SELECT)/i,/^(?:DISTINCT)/i,/^(?:REDUCED)/i,/^(?:\()/i,/^(?:AS)/i,/^(?:\))/i,/^(?:\*)/i,/^(?:CONSTRUCT)/i,/^(?:WHERE)/i,/^(?:\{)/i,/^(?:\})/i,/^(?:DESCRIBE)/i,/^(?:ASK)/i,/^(?:FROM)/i,/^(?:NAMED)/i,/^(?:GROUP)/i,/^(?:BY)/i,/^(?:HAVING)/i,/^(?:ORDER)/i,/^(?:ASC)/i,/^(?:DESC)/i,/^(?:LIMIT)/i,/^(?:OFFSET)/i,/^(?:VALUES)/i,/^(?:;)/i,/^(?:LOAD)/i,/^(?:SILENT)/i,/^(?:INTO)/i,/^(?:CLEAR)/i,/^(?:DROP)/i,/^(?:CREATE)/i,/^(?:ADD)/i,/^(?:TO)/i,/^(?:MOVE)/i,/^(?:COPY)/i,/^(?:INSERT\s+DATA)/i,/^(?:DELETE\s+DATA)/i,/^(?:DELETE\s+WHERE)/i,/^(?:WITH)/i,/^(?:DELETE)/i,/^(?:INSERT)/i,/^(?:USING)/i,/^(?:DEFAULT)/i,/^(?:GRAPH)/i,/^(?:ALL)/i,/^(?:\.)/i,/^(?:OPTIONAL)/i,/^(?:SERVICE)/i,/^(?:BIND)/i,/^(?:UNDEF)/i,/^(?:MINUS)/i,/^(?:UNION)/i,/^(?:FILTER)/i,/^(?:,)/i,/^(?:a)/i,/^(?:\|)/i,/^(?:\/)/i,/^(?:\^)/i,/^(?:\?)/i,/^(?:\+)/i,/^(?:!)/i,/^(?:\[)/i,/^(?:\])/i,/^(?:\|\|)/i,/^(?:&&)/i,/^(?:=)/i,/^(?:!=)/i,/^(?:<)/i,/^(?:>)/i,/^(?:<=)/i,/^(?:>=)/i,/^(?:IN)/i,/^(?:NOT)/i,/^(?:-)/i,/^(?:BOUND)/i,/^(?:BNODE)/i,/^(?:(RAND|NOW|UUID|STRUUID))/i,/^(?:(LANG|DATATYPE|IRI|URI|ABS|CEIL|FLOOR|ROUND|STRLEN|STR|UCASE|LCASE|ENCODE_FOR_URI|YEAR|MONTH|DAY|HOURS|MINUTES|SECONDS|TIMEZONE|TZ|MD5|SHA1|SHA256|SHA384|SHA512|isIRI|isURI|isBLANK|isLITERAL|isNUMERIC))/i,/^(?:(LANGMATCHES|CONTAINS|STRSTARTS|STRENDS|STRBEFORE|STRAFTER|STRLANG|STRDT|sameTerm))/i,/^(?:CONCAT)/i,/^(?:COALESCE)/i,/^(?:IF)/i,/^(?:REGEX)/i,/^(?:SUBSTR)/i,/^(?:REPLACE)/i,/^(?:EXISTS)/i,/^(?:COUNT)/i,/^(?:SUM|MIN|MAX|AVG|SAMPLE)/i,/^(?:GROUP_CONCAT)/i,/^(?:SEPARATOR)/i,/^(?:\^\^)/i,/^(?:true)/i,/^(?:false)/i,/^(?:(<([^<>\"\{\}\|\^`\\\u0000-\u0020])*>))/i,/^(?:((([A-Z]|[a-z]|[\u00C0-\u00D6]|[\u00D8-\u00F6]|[\u00F8-\u02FF]|[\u0370-\u037D]|[\u037F-\u1FFF]|[\u200C-\u200D]|[\u2070-\u218F]|[\u2C00-\u2FEF]|[\u3001-\uD7FF]|[\uF900-\uFDCF]|[\uFDF0-\uFFFD]|[\uD800-\uDB7F][\uDC00-\uDFFF])(((((?:([A-Z]|[a-z]|[\u00C0-\u00D6]|[\u00D8-\u00F6]|[\u00F8-\u02FF]|[\u0370-\u037D]|[\u037F-\u1FFF]|[\u200C-\u200D]|[\u2070-\u218F]|[\u2C00-\u2FEF]|[\u3001-\uD7FF]|[\uF900-\uFDCF]|[\uFDF0-\uFFFD]|[\uD800-\uDB7F][\uDC00-\uDFFF])|_))|-|[0-9]|\u00B7|[\u0300-\u036F]|[\u203F-\u2040])|\.)*(((?:([A-Z]|[a-z]|[\u00C0-\u00D6]|[\u00D8-\u00F6]|[\u00F8-\u02FF]|[\u0370-\u037D]|[\u037F-\u1FFF]|[\u200C-\u200D]|[\u2070-\u218F]|[\u2C00-\u2FEF]|[\u3001-\uD7FF]|[\uF900-\uFDCF]|[\uFDF0-\uFFFD]|[\uD800-\uDB7F][\uDC00-\uDFFF])|_))|-|[0-9]|\u00B7|[\u0300-\u036F]|[\u203F-\u2040]))?)?:))/i,/^(?:(((([A-Z]|[a-z]|[\u00C0-\u00D6]|[\u00D8-\u00F6]|[\u00F8-\u02FF]|[\u0370-\u037D]|[\u037F-\u1FFF]|[\u200C-\u200D]|[\u2070-\u218F]|[\u2C00-\u2FEF]|[\u3001-\uD7FF]|[\uF900-\uFDCF]|[\uFDF0-\uFFFD]|[\uD800-\uDB7F][\uDC00-\uDFFF])(((((?:([A-Z]|[a-z]|[\u00C0-\u00D6]|[\u00D8-\u00F6]|[\u00F8-\u02FF]|[\u0370-\u037D]|[\u037F-\u1FFF]|[\u200C-\u200D]|[\u2070-\u218F]|[\u2C00-\u2FEF]|[\u3001-\uD7FF]|[\uF900-\uFDCF]|[\uFDF0-\uFFFD]|[\uD800-\uDB7F][\uDC00-\uDFFF])|_))|-|[0-9]|\u00B7|[\u0300-\u036F]|[\u203F-\u2040])|\.)*(((?:([A-Z]|[a-z]|[\u00C0-\u00D6]|[\u00D8-\u00F6]|[\u00F8-\u02FF]|[\u0370-\u037D]|[\u037F-\u1FFF]|[\u200C-\u200D]|[\u2070-\u218F]|[\u2C00-\u2FEF]|[\u3001-\uD7FF]|[\uF900-\uFDCF]|[\uFDF0-\uFFFD]|[\uD800-\uDB7F][\uDC00-\uDFFF])|_))|-|[0-9]|\u00B7|[\u0300-\u036F]|[\u203F-\u2040]))?)?:)((((?:([A-Z]|[a-z]|[\u00C0-\u00D6]|[\u00D8-\u00F6]|[\u00F8-\u02FF]|[\u0370-\u037D]|[\u037F-\u1FFF]|[\u200C-\u200D]|[\u2070-\u218F]|[\u2C00-\u2FEF]|[\u3001-\uD7FF]|[\uF900-\uFDCF]|[\uFDF0-\uFFFD]|[\uD800-\uDB7F][\uDC00-\uDFFF])|_))|:|[0-9]|((%([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f]))|(\\(_|~|\.|-|!|\$|&|'|\(|\)|\*|\+|,|;|=|\/|\?|#|@|%))))(((((?:([A-Z]|[a-z]|[\u00C0-\u00D6]|[\u00D8-\u00F6]|[\u00F8-\u02FF]|[\u0370-\u037D]|[\u037F-\u1FFF]|[\u200C-\u200D]|[\u2070-\u218F]|[\u2C00-\u2FEF]|[\u3001-\uD7FF]|[\uF900-\uFDCF]|[\uFDF0-\uFFFD]|[\uD800-\uDB7F][\uDC00-\uDFFF])|_))|-|[0-9]|\u00B7|[\u0300-\u036F]|[\u203F-\u2040])|\.|:|((%([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f]))|(\\(_|~|\.|-|!|\$|&|'|\(|\)|\*|\+|,|;|=|\/|\?|#|@|%))))*((((?:([A-Z]|[a-z]|[\u00C0-\u00D6]|[\u00D8-\u00F6]|[\u00F8-\u02FF]|[\u0370-\u037D]|[\u037F-\u1FFF]|[\u200C-\u200D]|[\u2070-\u218F]|[\u2C00-\u2FEF]|[\u3001-\uD7FF]|[\uF900-\uFDCF]|[\uFDF0-\uFFFD]|[\uD800-\uDB7F][\uDC00-\uDFFF])|_))|-|[0-9]|\u00B7|[\u0300-\u036F]|[\u203F-\u2040])|:|((%([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f]))|(\\(_|~|\.|-|!|\$|&|'|\(|\)|\*|\+|,|;|=|\/|\?|#|@|%)))))?)))/i,/^(?:(_:(((?:([A-Z]|[a-z]|[\u00C0-\u00D6]|[\u00D8-\u00F6]|[\u00F8-\u02FF]|[\u0370-\u037D]|[\u037F-\u1FFF]|[\u200C-\u200D]|[\u2070-\u218F]|[\u2C00-\u2FEF]|[\u3001-\uD7FF]|[\uF900-\uFDCF]|[\uFDF0-\uFFFD]|[\uD800-\uDB7F][\uDC00-\uDFFF])|_))|[0-9])(((((?:([A-Z]|[a-z]|[\u00C0-\u00D6]|[\u00D8-\u00F6]|[\u00F8-\u02FF]|[\u0370-\u037D]|[\u037F-\u1FFF]|[\u200C-\u200D]|[\u2070-\u218F]|[\u2C00-\u2FEF]|[\u3001-\uD7FF]|[\uF900-\uFDCF]|[\uFDF0-\uFFFD]|[\uD800-\uDB7F][\uDC00-\uDFFF])|_))|-|[0-9]|\u00B7|[\u0300-\u036F]|[\u203F-\u2040])|\.)*(((?:([A-Z]|[a-z]|[\u00C0-\u00D6]|[\u00D8-\u00F6]|[\u00F8-\u02FF]|[\u0370-\u037D]|[\u037F-\u1FFF]|[\u200C-\u200D]|[\u2070-\u218F]|[\u2C00-\u2FEF]|[\u3001-\uD7FF]|[\uF900-\uFDCF]|[\uFDF0-\uFFFD]|[\uD800-\uDB7F][\uDC00-\uDFFF])|_))|-|[0-9]|\u00B7|[\u0300-\u036F]|[\u203F-\u2040]))?))/i,/^(?:([\?\$]((((?:([A-Z]|[a-z]|[\u00C0-\u00D6]|[\u00D8-\u00F6]|[\u00F8-\u02FF]|[\u0370-\u037D]|[\u037F-\u1FFF]|[\u200C-\u200D]|[\u2070-\u218F]|[\u2C00-\u2FEF]|[\u3001-\uD7FF]|[\uF900-\uFDCF]|[\uFDF0-\uFFFD]|[\uD800-\uDB7F][\uDC00-\uDFFF])|_))|[0-9])(((?:([A-Z]|[a-z]|[\u00C0-\u00D6]|[\u00D8-\u00F6]|[\u00F8-\u02FF]|[\u0370-\u037D]|[\u037F-\u1FFF]|[\u200C-\u200D]|[\u2070-\u218F]|[\u2C00-\u2FEF]|[\u3001-\uD7FF]|[\uF900-\uFDCF]|[\uFDF0-\uFFFD]|[\uD800-\uDB7F][\uDC00-\uDFFF])|_))|[0-9]|\u00B7|[\u0300-\u036F]|[\u203F-\u2040])*)))/i,/^(?:(@[a-zA-Z]+(-[a-zA-Z0-9]+)*))/i,/^(?:([0-9]+))/i,/^(?:([0-9]*\.[0-9]+))/i,/^(?:([0-9]+\.[0-9]*([eE][+-]?[0-9]+)|\.([0-9])+([eE][+-]?[0-9]+)|([0-9])+([eE][+-]?[0-9]+)))/i,/^(?:(\+([0-9]+)))/i,/^(?:(\+([0-9]*\.[0-9]+)))/i,/^(?:(\+([0-9]+\.[0-9]*([eE][+-]?[0-9]+)|\.([0-9])+([eE][+-]?[0-9]+)|([0-9])+([eE][+-]?[0-9]+))))/i,/^(?:(-([0-9]+)))/i,/^(?:(-([0-9]*\.[0-9]+)))/i,/^(?:(-([0-9]+\.[0-9]*([eE][+-]?[0-9]+)|\.([0-9])+([eE][+-]?[0-9]+)|([0-9])+([eE][+-]?[0-9]+))))/i,/^(?:([eE][+-]?[0-9]+))/i,/^(?:('(([^\u0027\u005C\u000A\u000D])|(\\[tbnrf\\\"']|\\u([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f])|\\U([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f])))*'))/i,/^(?:("(([^\u0022\u005C\u000A\u000D])|(\\[tbnrf\\\"']|\\u([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f])|\\U([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f])))*"))/i,/^(?:('''(('|'')?([^'\\]|(\\[tbnrf\\\"']|\\u([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f])|\\U([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f]))))*'''))/i,/^(?:("""(("|"")?([^\"\\]|(\\[tbnrf\\\"']|\\u([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f])|\\U([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f])([0-9]|[A-F]|[a-f]))))*"""))/i,/^(?:(\((\u0020|\u0009|\u000D|\u000A)*\)))/i,/^(?:(\[(\u0020|\u0009|\u000D|\u000A)*\]))/i,/^(?:$)/i,/^(?:.)/i,/^(?:.)/i],
conditions: {"INITIAL":{"rules":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116,117,118,119,120],"inclusive":true}}
});
return lexer;
})();
parser.lexer = lexer;
function Parser () {
  this.yy = {};
}
Parser.prototype = parser;parser.Parser = Parser;
return new Parser;
})();


if (typeof require !== 'undefined' && typeof exports !== 'undefined') {
exports.parser = SparqlParser;
exports.Parser = SparqlParser.Parser;
exports.parse = function () { return SparqlParser.parse.apply(SparqlParser, arguments); };
exports.main = function commonjsMain(args) {
    if (!args[1]) {
        console.log('Usage: '+args[0]+' FILE');
        process.exit(1);
    }
    var source = require('fs').readFileSync(require('path').normalize(args[1]), "utf8");
    return exports.parser.parse(source);
};
if (typeof module !== 'undefined' && require.main === module) {
  exports.main(process.argv.slice(1));
}
}
}).call(this,require('_process'))
},{"_process":4,"fs":4,"path":4}],3:[function(require,module,exports){
var Parser = require('./lib/SparqlParser').Parser;
var Generator = require('./lib/SparqlGenerator');

module.exports = {
  /**
   * Creates a SPARQL parser with the given pre-defined prefixes and base IRI
   * @param prefixes { [prefix: string]: string }
   * @param baseIRI string
   * @param options {
   *   collapseGroups: boolean // default: true
   * }
   */
  Parser: function (prefixes, baseIRI, options) {
    // Create a copy of the prefixes
    var prefixesCopy = {};
    for (var prefix in prefixes || {})
      prefixesCopy[prefix] = prefixes[prefix];

    // Create a new parser with the given prefixes
    // (Workaround for https://github.com/zaach/jison/issues/241)
    var parser = new Parser();
    parser.parse = function () {
      Parser.base = baseIRI || '';
      Parser.prefixes = Object.create(prefixesCopy);
      Parser.options  = Object.assign({ collapseGroups: true }, options);
      return Parser.prototype.parse.apply(parser, arguments);
    };
    parser._resetBlanks = Parser._resetBlanks;
    return parser;
  },
  Generator: Generator,
};

},{"./lib/SparqlGenerator":1,"./lib/SparqlParser":2}],4:[function(require,module,exports){

},{}]},{},[3])(3)
});