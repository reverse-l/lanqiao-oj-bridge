export type LanguageId='cpp'|'c';
export const LANGUAGES={
 cpp:{label:'C++',fileName:'main.cpp',officialLabel:'C++（g++17）'},
 c:{label:'C',fileName:'main.c',officialLabel:'C（gcc8.3.0）'}
} as const;
export function requireLanguage(value:unknown):LanguageId {
 if(value===undefined)return 'cpp';
 if(value==='cpp'||value==='c')return value;
 throw new Error('只支持 C++ 和 C 语言');
}
export function languageOfSource(source:string):LanguageId|undefined {
 return source.endsWith('.cpp')?'cpp':source.endsWith('.c')?'c':undefined;
}
export const sourceName=(source:string)=>source.split(/[\\/]/).at(-1)||'';
export const C_TEMPLATE='#include <stdio.h>\n\nint main(void) {\n    /* 在这里编写解法 */\n    return 0;\n}\n';
