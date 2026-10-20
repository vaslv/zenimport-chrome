"""Emit independent exact-arithmetic expectations; changes require contract review."""
from decimal import Decimal, localcontext
import json
import random

rng = random.Random(0x20261020)


def decimal_string():
    sign = '-' if rng.randrange(2) else ''
    integer = str(rng.randrange(10**rng.randint(1, 24)))
    scale = rng.randrange(13)
    return sign + integer + ('.' + ''.join(str(rng.randrange(10)) for _ in range(scale)) if scale else '')


def plain(value):
    if not value:
        return '0'
    result = format(value, 'f')
    return result.rstrip('0').rstrip('.') if '.' in result else result


vectors = []
with localcontext() as context:
    context.prec = 120
    for _ in range(500):
        left, right = decimal_string(), decimal_string()
        a, b = Decimal(left), Decimal(right)
        vectors.append(dict(left=left, right=right, sum=plain(a+b), subtract=plain(a-b),
                            compare=(a > b)-(a < b), sign=(a > 0)-(a < 0)))
print(json.dumps({'seed': '20261020', 'vectors': vectors}, ensure_ascii=False, indent=2))
