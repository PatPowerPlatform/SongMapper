# Song Mapper v2

Lokalna PWA na iPhone / Safari do mapowania struktury utworów.

## Nowości v2
- lokalna biblioteka utworów w IndexedDB,
- automatyczny BPM,
- beat/bar-aware snapping granic sekcji,
- Intro / Verse / Pre-Chorus / Chorus / Bridge / Break / Outro,
- automatyczne numerowanie Verse 1, Verse 2, Chorus 1 itd.,
- confidence dla całej analizy i każdej sekcji,
- waveform z granicami sekcji i siatką taktów,
- pętla wybranej sekcji z korektą końca ±0.1 s,
- playback 0.75x / 0.90x / 1x / 1.10x / 1.25x,
- poprzednia/następna sekcja,
- ręczna edycja, dodawanie i dzielenie sekcji,
- ponowna analiza,
- przygotowanie raportu do ChatGPT przez systemowe Udostępnij lub schowek.

## ChatGPT Plus
ChatGPT Plus i OpenAI API to osobne produkty. Ta wersja nie wymaga API ani dodatkowej opłaty.
Przycisk „Udostępnij analizę” generuje gotowy prompt z wynikami i uruchamia systemowy arkusz udostępniania iOS. Jeśli ChatGPT jest dostępny jako cel udostępniania, można go wybrać; w przeciwnym razie użyj „Kopiuj prompt”.

## Instalacja na iPhone
Najwygodniej przez GitHub Pages:
1. Wgraj wszystkie pliki do repozytorium.
2. Settings -> Pages -> Deploy from branch -> main / root.
3. Otwórz HTTPS w Safari na iPhone.
4. Udostępnij -> Dodaj do ekranu początkowego.
5. Otwieraj z ikony Song Mapper.

## Prywatność
Audio nie jest wysyłane przez aplikację do żadnego API. Jest przechowywane lokalnie w IndexedDB PWA.
Użycie „Udostępnij analizę” przekazuje wyłącznie tekstowy raport, nie sam plik audio.
