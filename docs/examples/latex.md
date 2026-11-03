# LaTeX gallery

LaTeX is enabled by default in Preferences → Plugins. Every expression in this
document renders locally in Live Preview, translated reading and export.

## Inline and display delimiters

An inline formula: $E = mc^2$. Parenthesized TeX: \(a^2 + b^2 = c^2\).

$$x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$$

\[
e^{i\pi} + 1 = 0
\]

```math
\binom{n}{k} = \frac{n!}{k!(n-k)!}
```

## Fractions, roots and continued fractions

$$
\sqrt[3]{x} + \cfrac{1}{1 + \cfrac{1}{2 + \cfrac{1}{3}}}
$$

## Sums, products and integrals

$$
\sum_{k=1}^{n} k = \frac{n(n+1)}{2},\qquad
\prod_{k=1}^{n} k = n!,\qquad
\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}
$$

## Limits and derivatives

$$
\lim_{h\to 0}\frac{f(x+h)-f(x)}{h}=f'(x),\qquad
\frac{\partial^2 u}{\partial t^2}=c^2\nabla^2 u
$$

## Matrices and determinants

$$
A=\begin{pmatrix}a&b\\c&d\end{pmatrix},\qquad
\det A=\begin{vmatrix}a&b\\c&d\end{vmatrix}=ad-bc
$$

## Piecewise functions

$$
|x|=\begin{cases}x&\text{if }x\geq0\\-x&\text{otherwise}\end{cases}
$$

## Aligned equations and tags

$$
\begin{aligned}
(a+b)^2 &= a^2+2ab+b^2\\
(a-b)^2 &= a^2-2ab+b^2
\end{aligned}\tag{1}
$$

## Sets, logic and probability

$$
\forall x\in\mathbb{R},\quad x^2\geq0;\qquad
\mathbb{P}(A\mid B)=\frac{\mathbb{P}(A\cap B)}{\mathbb{P}(B)}
$$

## Vectors, tensors and arrows

$$
\boldsymbol{F}=m\boldsymbol{a},\qquad
\vec{u}\times\vec{v},\qquad
A\xrightarrow{f}B\xrightarrow{g}C
$$

## Brackets and quantum notation

$$
\Braket{\psi|\hat{H}|\psi},\qquad \ket{0}\bra{1},\qquad
\left\langle\frac{a}{b}\right\rangle
$$

## Physics and differential notation

$$
\dv{f}{x}+\pdv[2]{u}{t}=\expval{\hat{H}}\qquad\qty(\frac{x}{y})
$$

## Cancellations and annotations

$$
\frac{\cancel{a}b}{\cancel{a}c}=\frac{b}{c},\qquad
\underbrace{1+\cdots+1}_{n\text{ terms}}=n
$$

## Mathtools and upright Greek

$$
f(x)\coloneqq x^2,\qquad a\xleftrightarrow{\text{equivalent}}b,\qquad
\uppi\approx3.14159
$$

## Chemical reactions and units

$$
\ce{2 H2 + O2 -> 2 H2O},\qquad
\ce{CO2 + C -> 2 CO},\qquad
\pu{9.81 m s-2}
$$

## Commutative diagrams

$$
\begin{CD}
A @>f>> B\\
@VgVV @VVhV\\
C @>>k> D
\end{CD}
$$

## Color and enclosures

$$
\color{teal}{x+y}\qquad\bbox[4px,border:1px solid black]{E=mc^2}\qquad
\enclose{circle}{x}
$$

## Local macros and text

$$
\newcommand{\RR}{\mathbb{R}}
f:\RR\to\RR,\qquad\text{rate }r=\frac{\text{distance}}{\text{time}}
$$

Macros belong to one expression. Invalid or oversized expressions retain their
source with an edit or retry action. Unfinished delimiters remain editable Markdown.
