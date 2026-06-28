# Third-Party Notices

INTERCEPT is original work. A small number of components adapt algorithms from
permissively-licensed open-source projects. As required by their licenses, the
attributions and full license texts for that copied/ported code are reproduced
below. (Clean-room implementations, runtime npm/CDN dependencies, and our own
first-party code are not listed here — only genuinely copied source is.)

---

## email-sleuth

- **Used in:** `convex/enrich/emailGuess.ts` (email pattern generation, the
  generic / role-account prefix set, and the confidence-scoring rubric).
- **Project:** email-sleuth — https://github.com/buyukakyuz/email-sleuth
- **License:** MIT
- **Copyright:** © buyukakyuz and the email-sleuth contributors

```
MIT License

Copyright (c) buyukakyuz and the email-sleuth contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Virality scoring rubric (virally / claude-auto-tok)

- **Used in:** `convex/virality/scoring.ts` (the deterministic per-dimension
  virality-scoring rubric).
- **Projects:** `virally` and `claude-auto-tok`
- **License:** MIT
- **Copyright:** © the respective project authors

```
MIT License

Copyright (c) the virally and claude-auto-tok authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
