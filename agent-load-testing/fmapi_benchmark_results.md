# Databricks FMAPI Streaming Benchmark Results

**Date:** 2026-03-31
**Host:** eng-ml-agent-platform.staging.cloud.databricks.com
**Prompt:** "Calculate the 10th fibonacci number using python code and execute it."
**Runs per config:** 5
**Streaming:** Yes (SSE)

## Summary Table


| Config           | Model                            | Avg Total (ms) | Avg TTFT (ms) | Avg Chunks | Avg Inter-Chunk (ms) | Avg Resp Len |
| ---------------- | -------------------------------- | -------------- | ------------- | ---------- | -------------------- | ------------ |
| no_limit         | claude-3-7-sonnet                | 3953           | 832           | 52         | 62.5                 | 690          |
| no_limit         | gpt-5-4                          | 1511           | 626           | 86         | 10.0                 | 231          |
| no_limit         | gpt-5-4-mini                     | 959            | 525           | 79         | 5.1                  | 244          |
| no_limit         | claude-opus-4-6                  | 6110           | 2379          | 65         | 57.1                 | 738          |
| no_limit         | gemini-3-1-pro                   | 11443          | 9502          | 5          | 471.8                | 649          |
| no_limit         | databricks-gemini-3-1-flash-lite | ERROR          | ERROR         | ERROR      | ERROR                | ERROR        |
| max_tokens=500   | claude-3-7-sonnet                | 4009           | 918           | 72         | 44.8                 | 688          |
| max_tokens=500   | gpt-5-4                          | 1455           | 648           | 81         | 9.7                  | 222          |
| max_tokens=500   | gpt-5-4-mini                     | 1328           | 880           | 86         | 4.7                  | 270          |
| max_tokens=500   | claude-opus-4-6                  | 5491           | 2559          | 59         | 50.4                 | 709          |
| max_tokens=500   | gemini-3-1-pro                   | 7909           | 7619          | 2          | 113.9                | 272          |
| max_tokens=500   | databricks-gemini-3-1-flash-lite | ERROR          | ERROR         | ERROR      | ERROR                | ERROR        |
| max_tokens=1000  | claude-3-7-sonnet                | 4402           | 951           | 60         | 59.4                 | 728          |
| max_tokens=1000  | gpt-5-4                          | 1727           | 822           | 87         | 10.0                 | 236          |
| max_tokens=1000  | gpt-5-4-mini                     | 1080           | 722           | 73         | 4.3                  | 217          |
| max_tokens=1000  | claude-opus-4-6                  | 5216           | 2047          | 59         | 54.0                 | 686          |
| max_tokens=1000  | gemini-3-1-pro                   | 7040           | 5985          | 4          | 309.2                | 600          |
| max_tokens=1000  | databricks-gemini-3-1-flash-lite | ERROR          | ERROR         | ERROR      | ERROR                | ERROR        |
| max_tokens=10000 | claude-3-7-sonnet                | 4294           | 937           | 69         | 49.5                 | 732          |
| max_tokens=10000 | gpt-5-4                          | 1664           | 696           | 81         | 11.4                 | 230          |
| max_tokens=10000 | gpt-5-4-mini                     | 1206           | 806           | 81         | 4.6                  | 249          |
| max_tokens=10000 | claude-opus-4-6                  | 4964           | 2004          | 59         | 50.7                 | 703          |
| max_tokens=10000 | gemini-3-1-pro                   | 6730           | 5585          | 5          | 321.5                | 594          |
| max_tokens=10000 | databricks-gemini-3-1-flash-lite | ERROR          | ERROR         | ERROR      | ERROR                | ERROR        |


## Config: no_limit

### databricks-claude-3-7-sonnet


| Run       | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
| --------- | ---------- | --------- | ------ | --------------------- | ----------- | ------ |
| 1         | 3755       | 821       | 42     | 71.5                  | 709         | OK     |
| 2         | 3784       | 776       | 41     | 75.2                  | 686         | OK     |
| 3         | 4263       | 917       | 58     | 58.7                  | 717         | OK     |
| 4         | 3693       | 792       | 60     | 48.0                  | 649         | OK     |
| 5         | 4270       | 856       | 59     | 58.9                  | 687         | OK     |
| **Avg**   | **3953**   | **832**   | **52** | **62.5**              | **690**     | 5/5 OK |
| **Stdev** | 288        | 56        | 10     | -                     | 26          | -      |


### databricks-gpt-5-4


| Run       | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
| --------- | ---------- | --------- | ------ | --------------------- | ----------- | ------ |
| 1         | 1462       | 642       | 88     | 8.9                   | 254         | OK     |
| 2         | 1387       | 561       | 73     | 11.2                  | 194         | OK     |
| 3         | 1609       | 744       | 88     | 9.4                   | 242         | OK     |
| 4         | 1353       | 560       | 73     | 10.5                  | 194         | OK     |
| 5         | 1744       | 621       | 109    | 10.0                  | 269         | OK     |
| **Avg**   | **1511**   | **626**   | **86** | **10.0**              | **231**     | 5/5 OK |
| **Stdev** | 163        | 76        | 15     | -                     | 35          | -      |


### databricks-gpt-5-4-mini


| Run       | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
| --------- | ---------- | --------- | ------ | --------------------- | ----------- | ------ |
| 1         | 1075       | 561       | 84     | 5.7                   | 267         | OK     |
| 2         | 1042       | 538       | 82     | 5.8                   | 268         | OK     |
| 3         | 721        | 414       | 56     | 4.4                   | 141         | OK     |
| 4         | 911        | 502       | 86     | 4.7                   | 267         | OK     |
| 5         | 1044       | 613       | 89     | 4.7                   | 278         | OK     |
| **Avg**   | **959**    | **525**   | **79** | **5.1**               | **244**     | 5/5 OK |
| **Stdev** | 147        | 74        | 13     | -                     | 58          | -      |


### databricks-claude-opus-4-6


| Run       | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
| --------- | ---------- | --------- | ------ | --------------------- | ----------- | ------ |
| 1         | 4906       | 1970      | 55     | 53.8                  | 652         | OK     |
| 2         | 6078       | 2110      | 70     | 54.7                  | 766         | OK     |
| 3         | 7220       | 3920      | 63     | 52.9                  | 737         | OK     |
| 4         | 6878       | 2239      | 67     | 68.9                  | 767         | OK     |
| 5         | 5467       | 1656      | 69     | 55.0                  | 767         | OK     |
| **Avg**   | **6110**   | **2379**  | **65** | **57.1**              | **738**     | 5/5 OK |
| **Stdev** | 960        | 888       | 6      | -                     | 50          | -      |


### databricks-gemini-3-1-pro


| Run       | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
| --------- | ---------- | --------- | ------ | --------------------- | ----------- | ------ |
| 1         | 8667       | 7117      | 5      | 387.4                 | 629         | OK     |
| 2         | 26377      | 21662     | 6      | 940.9                 | 762         | OK     |
| 3         | 7460       | 6622      | 4      | 278.1                 | 610         | OK     |
| 4         | 7646       | 6409      | 4      | 412.1                 | 604         | OK     |
| 5         | 7063       | 5701      | 5      | 340.3                 | 642         | OK     |
| **Avg**   | **11443**  | **9502**  | **5**  | **471.8**             | **649**     | 5/5 OK |
| **Stdev** | 8369       | 6817      | 1      | -                     | 65          | -      |


### databricks-gemini-3-1-flash-lite


| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status                                                              |
| --- | ---------- | --------- | ------ | --------------------- | ----------- | ------------------------------------------------------------------- |
| 1   | 255        | -         | -      | -                     | -           | ERROR: HTTP 502: {"error_code":"INTERNAL_ERROR","message":"The serv |
| 2   | 285        | -         | -      | -                     | -           | ERROR: HTTP 502: {"error_code":"INTERNAL_ERROR","message":"The serv |
| 3   | 282        | -         | -      | -                     | -           | ERROR: HTTP 502: {"error_code":"INTERNAL_ERROR","message":"The serv |
| 4   | 233        | -         | -      | -                     | -           | ERROR: HTTP 502: {"error_code":"INTERNAL_ERROR","message":"The serv |
| 5   | 211        | -         | -      | -                     | -           | ERROR: HTTP 502: {"error_code":"INTERNAL_ERROR","message":"The serv |


## Config: max_tokens=500

### databricks-claude-3-7-sonnet


| Run       | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
| --------- | ---------- | --------- | ------ | --------------------- | ----------- | ------ |
| 1         | 4011       | 831       | 68     | 47.4                  | 704         | OK     |
| 2         | 3764       | 1083      | 73     | 36.6                  | 617         | OK     |
| 3         | 4367       | 1101      | 90     | 36.3                  | 786         | OK     |
| 4         | 3968       | 753       | 75     | 42.9                  | 705         | OK     |
| 5         | 3935       | 824       | 52     | 61.0                  | 629         | OK     |
| **Avg**   | **4009**   | **918**   | **72** | **44.8**              | **688**     | 5/5 OK |
| **Stdev** | 221        | 162       | 14     | -                     | 68          | -      |


### databricks-gpt-5-4


| Run       | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
| --------- | ---------- | --------- | ------ | --------------------- | ----------- | ------ |
| 1         | 1396       | 708       | 71     | 9.6                   | 203         | OK     |
| 2         | 1363       | 578       | 73     | 10.5                  | 194         | OK     |
| 3         | 1551       | 649       | 87     | 9.8                   | 233         | OK     |
| 4         | 1467       | 701       | 87     | 8.6                   | 245         | OK     |
| 5         | 1501       | 606       | 87     | 9.9                   | 233         | OK     |
| **Avg**   | **1455**   | **648**   | **81** | **9.7**               | **222**     | 5/5 OK |
| **Stdev** | 76         | 57        | 8      | -                     | 22          | -      |


### databricks-gpt-5-4-mini


| Run       | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
| --------- | ---------- | --------- | ------ | --------------------- | ----------- | ------ |
| 1         | 1347       | 896       | 86     | 4.9                   | 260         | OK     |
| 2         | 1433       | 988       | 84     | 4.3                   | 267         | OK     |
| 3         | 1307       | 879       | 92     | 4.5                   | 290         | OK     |
| 4         | 1577       | 1155      | 86     | 4.3                   | 278         | OK     |
| 5         | 975        | 483       | 84     | 5.3                   | 255         | OK     |
| **Avg**   | **1328**   | **880**   | **86** | **4.7**               | **270**     | 5/5 OK |
| **Stdev** | 223        | 247       | 3      | -                     | 14          | -      |


### databricks-claude-opus-4-6


| Run       | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
| --------- | ---------- | --------- | ------ | --------------------- | ----------- | ------ |
| 1         | 6485       | 4103      | 67     | 35.4                  | 798         | OK     |
| 2         | 6723       | 3224      | 67     | 51.5                  | 765         | OK     |
| 3         | 4727       | 1853      | 53     | 54.7                  | 665         | OK     |
| 4         | 4584       | 1786      | 52     | 54.4                  | 665         | OK     |
| 5         | 4934       | 1831      | 56     | 55.8                  | 652         | OK     |
| **Avg**   | **5491**   | **2559**  | **59** | **50.4**              | **709**     | 5/5 OK |
| **Stdev** | 1027       | 1055      | 7      | -                     | 67          | -      |


### databricks-gemini-3-1-pro


| Run       | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
| --------- | ---------- | --------- | ------ | --------------------- | ----------- | ------ |
| 1         | 6010       | 5964      | 2      | 44.5                  | 220         | OK     |
| 2         | 5815       | 5815      | 1      | 0.0                   | 75          | OK     |
| 3         | 15794      | 15794     | 1      | 0.0                   | 66          | OK     |
| 4         | 4908       | 4549      | 3      | 177.9                 | 489         | OK     |
| 5         | 7016       | 5974      | 4      | 347.0                 | 512         | OK     |
| **Avg**   | **7909**   | **7619**  | **2**  | **113.9**             | **272**     | 5/5 OK |
| **Stdev** | 4471       | 4609      | 1      | -                     | 217         | -      |


### databricks-gemini-3-1-flash-lite


| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status                                                              |
| --- | ---------- | --------- | ------ | --------------------- | ----------- | ------------------------------------------------------------------- |
| 1   | 237        | -         | -      | -                     | -           | ERROR: HTTP 502: {"error_code":"INTERNAL_ERROR","message":"The serv |
| 2   | 263        | -         | -      | -                     | -           | ERROR: HTTP 502: {"error_code":"INTERNAL_ERROR","message":"The serv |
| 3   | 198        | -         | -      | -                     | -           | ERROR: HTTP 502: {"error_code":"INTERNAL_ERROR","message":"The serv |
| 4   | 222        | -         | -      | -                     | -           | ERROR: HTTP 502: {"error_code":"INTERNAL_ERROR","message":"The serv |
| 5   | 215        | -         | -      | -                     | -           | ERROR: HTTP 502: {"error_code":"INTERNAL_ERROR","message":"The serv |


## Config: max_tokens=1000

### databricks-claude-3-7-sonnet


| Run       | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
| --------- | ---------- | --------- | ------ | --------------------- | ----------- | ------ |
| 1         | 3593       | 957       | 74     | 35.5                  | 680         | OK     |
| 2         | 3746       | 787       | 47     | 62.5                  | 677         | OK     |
| 3         | 5807       | 1483      | 64     | 68.6                  | 897         | OK     |
| 4         | 4520       | 804       | 58     | 63.2                  | 667         | OK     |
| 5         | 4343       | 725       | 55     | 67.0                  | 717         | OK     |
| **Avg**   | **4402**   | **951**   | **60** | **59.4**              | **728**     | 5/5 OK |
| **Stdev** | 877        | 309       | 10     | -                     | 97          | -      |


### databricks-gpt-5-4


| Run       | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
| --------- | ---------- | --------- | ------ | --------------------- | ----------- | ------ |
| 1         | 1381       | 616       | 73     | 10.3                  | 194         | OK     |
| 2         | 1490       | 608       | 87     | 9.5                   | 233         | OK     |
| 3         | 1600       | 677       | 88     | 10.0                  | 242         | OK     |
| 4         | 2644       | 1614      | 100    | 10.3                  | 280         | OK     |
| 5         | 1521       | 593       | 87     | 10.0                  | 233         | OK     |
| **Avg**   | **1727**   | **822**   | **87** | **10.0**              | **236**     | 5/5 OK |
| **Stdev** | 518        | 444       | 10     | -                     | 31          | -      |


### databricks-gpt-5-4-mini


| Run       | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
| --------- | ---------- | --------- | ------ | --------------------- | ----------- | ------ |
| 1         | 1246       | 936       | 57     | 4.6                   | 150         | OK     |
| 2         | 849        | 444       | 86     | 4.1                   | 262         | OK     |
| 3         | 1157       | 913       | 54     | 3.8                   | 154         | OK     |
| 4         | 854        | 408       | 86     | 5.0                   | 265         | OK     |
| 5         | 1293       | 908       | 84     | 4.0                   | 256         | OK     |
| **Avg**   | **1080**   | **722**   | **73** | **4.3**               | **217**     | 5/5 OK |
| **Stdev** | 214        | 271       | 16     | -                     | 60          | -      |


### databricks-claude-opus-4-6


| Run       | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
| --------- | ---------- | --------- | ------ | --------------------- | ----------- | ------ |
| 1         | 5854       | 1943      | 71     | 54.0                  | 767         | OK     |
| 2         | 5350       | 2070      | 61     | 54.2                  | 719         | OK     |
| 3         | 4576       | 1854      | 51     | 53.4                  | 642         | OK     |
| 4         | 5356       | 2475      | 55     | 53.2                  | 652         | OK     |
| 5         | 4945       | 1894      | 56     | 55.3                  | 652         | OK     |
| **Avg**   | **5216**   | **2047**  | **59** | **54.0**              | **686**     | 5/5 OK |
| **Stdev** | 482        | 252       | 8      | -                     | 55          | -      |


### databricks-gemini-3-1-pro


| Run       | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
| --------- | ---------- | --------- | ------ | --------------------- | ----------- | ------ |
| 1         | 6968       | 6019      | 4      | 316.0                 | 591         | OK     |
| 2         | 6453       | 5981      | 4      | 156.9                 | 614         | OK     |
| 3         | 8733       | 7253      | 5      | 370.0                 | 629         | OK     |
| 4         | 6433       | 5105      | 4      | 442.3                 | 558         | OK     |
| 5         | 6612       | 5568      | 5      | 260.8                 | 607         | OK     |
| **Avg**   | **7040**   | **5985**  | **4**  | **309.2**             | **600**     | 5/5 OK |
| **Stdev** | 971        | 799       | 1      | -                     | 27          | -      |


### databricks-gemini-3-1-flash-lite


| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status                                                              |
| --- | ---------- | --------- | ------ | --------------------- | ----------- | ------------------------------------------------------------------- |
| 1   | 359        | -         | -      | -                     | -           | ERROR: HTTP 502: {"error_code":"INTERNAL_ERROR","message":"The serv |
| 2   | 395        | -         | -      | -                     | -           | ERROR: HTTP 502: {"error_code":"INTERNAL_ERROR","message":"The serv |
| 3   | 246        | -         | -      | -                     | -           | ERROR: HTTP 502: {"error_code":"INTERNAL_ERROR","message":"The serv |
| 4   | 316        | -         | -      | -                     | -           | ERROR: HTTP 502: {"error_code":"INTERNAL_ERROR","message":"The serv |
| 5   | 468        | -         | -      | -                     | -           | ERROR: HTTP 502: {"error_code":"INTERNAL_ERROR","message":"The serv |


## Config: max_tokens=10000

### databricks-claude-3-7-sonnet


| Run       | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
| --------- | ---------- | --------- | ------ | --------------------- | ----------- | ------ |
| 1         | 3894       | 948       | 61     | 49.0                  | 690         | OK     |
| 2         | 4377       | 1021      | 55     | 61.1                  | 647         | OK     |
| 3         | 4697       | 804       | 79     | 49.1                  | 763         | OK     |
| 4         | 4437       | 739       | 74     | 50.6                  | 809         | OK     |
| 5         | 4062       | 1171      | 78     | 37.5                  | 749         | OK     |
| **Avg**   | **4294**   | **937**   | **69** | **49.5**              | **732**     | 5/5 OK |
| **Stdev** | 318        | 173       | 11     | -                     | 64          | -      |


### databricks-gpt-5-4


| Run       | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
| --------- | ---------- | --------- | ------ | --------------------- | ----------- | ------ |
| 1         | 1637       | 700       | 89     | 10.1                  | 245         | OK     |
| 2         | 1653       | 639       | 87     | 11.6                  | 233         | OK     |
| 3         | 2202       | 784       | 88     | 15.5                  | 254         | OK     |
| 4         | 1498       | 637       | 71     | 11.9                  | 203         | OK     |
| 5         | 1328       | 722       | 71     | 7.9                   | 215         | OK     |
| **Avg**   | **1664**   | **696**   | **81** | **11.4**              | **230**     | 5/5 OK |
| **Stdev** | 328        | 61        | 9      | -                     | 21          | -      |


### databricks-gpt-5-4-mini


| Run       | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
| --------- | ---------- | --------- | ------ | --------------------- | ----------- | ------ |
| 1         | 1156       | 880       | 57     | 4.6                   | 151         | OK     |
| 2         | 1433       | 946       | 90     | 5.1                   | 274         | OK     |
| 3         | 851        | 429       | 86     | 4.5                   | 265         | OK     |
| 4         | 1334       | 917       | 88     | 4.4                   | 289         | OK     |
| 5         | 1255       | 858       | 86     | 4.3                   | 266         | OK     |
| **Avg**   | **1206**   | **806**   | **81** | **4.6**               | **249**     | 5/5 OK |
| **Stdev** | 223        | 213       | 14     | -                     | 56          | -      |


### databricks-claude-opus-4-6


| Run       | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
| --------- | ---------- | --------- | ------ | --------------------- | ----------- | ------ |
| 1         | 4596       | 1418      | 63     | 51.2                  | 737         | OK     |
| 2         | 4584       | 1904      | 52     | 52.5                  | 665         | OK     |
| 3         | 5378       | 3358      | 52     | 39.0                  | 665         | OK     |
| 4         | 4695       | 1685      | 56     | 54.7                  | 652         | OK     |
| 5         | 5567       | 1654      | 70     | 56.1                  | 798         | OK     |
| **Avg**   | **4964**   | **2004**  | **59** | **50.7**              | **703**     | 5/5 OK |
| **Stdev** | 471        | 776       | 8      | -                     | 63          | -      |


### databricks-gemini-3-1-pro


| Run       | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
| --------- | ---------- | --------- | ------ | --------------------- | ----------- | ------ |
| 1         | 6304       | 5546      | 4      | 251.8                 | 557         | OK     |
| 2         | 7177       | 6014      | 5      | 290.7                 | 615         | OK     |
| 3         | 6648       | 5295      | 5      | 338.3                 | 588         | OK     |
| 4         | 6308       | 4935      | 4      | 457.6                 | 616         | OK     |
| 5         | 7212       | 6135      | 5      | 268.9                 | 595         | OK     |
| **Avg**   | **6730**   | **5585**  | **5**  | **321.5**             | **594**     | 5/5 OK |
| **Stdev** | 447        | 499       | 1      | -                     | 24          | -      |


### databricks-gemini-3-1-flash-lite


| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status                                                              |
| --- | ---------- | --------- | ------ | --------------------- | ----------- | ------------------------------------------------------------------- |
| 1   | 212        | -         | -      | -                     | -           | ERROR: HTTP 502: {"error_code":"INTERNAL_ERROR","message":"The serv |
| 2   | 247        | -         | -      | -                     | -           | ERROR: HTTP 502: {"error_code":"INTERNAL_ERROR","message":"The serv |
| 3   | 207        | -         | -      | -                     | -           | ERROR: HTTP 502: {"error_code":"INTERNAL_ERROR","message":"The serv |
| 4   | 247        | -         | -      | -                     | -           | ERROR: HTTP 502: {"error_code":"INTERNAL_ERROR","message":"The serv |
| 5   | 228        | -         | -      | -                     | -           | ERROR: HTTP 502: {"error_code":"INTERNAL_ERROR","message":"The serv |


## Cross-Config Comparison (Avg Total Time ms)


| Model                 | no_limit | max_tokens=500 | max_tokens=1000 | max_tokens=10000 |
| --------------------- | -------- | -------------- | --------------- | ---------------- |
| claude-3-7-sonnet     | 3953     | 4009           | 4402            | 4294             |
| gpt-5-4               | 1511     | 1455           | 1727            | 1664             |
| gpt-5-4-mini          | 959      | 1328           | 1080            | 1206             |
| claude-opus-4-6       | 6110     | 5491           | 5216            | 4964             |
| gemini-3-1-pro        | 11443    | 7909           | 7040            | 6730             |
| gemini-3-1-flash-lite | ERROR    | ERROR          | ERROR           | ERROR            |


## Cross-Config Comparison (Avg TTFT ms)


| Model                 | no_limit | max_tokens=500 | max_tokens=1000 | max_tokens=10000 |
| --------------------- | -------- | -------------- | --------------- | ---------------- |
| claude-3-7-sonnet     | 832      | 918            | 951             | 937              |
| gpt-5-4               | 626      | 648            | 822             | 696              |
| gpt-5-4-mini          | 525      | 880            | 722             | 806              |
| claude-opus-4-6       | 2379     | 2559           | 2047            | 2004             |
| gemini-3-1-pro        | 9502     | 7619           | 5985            | 5585             |
| gemini-3-1-flash-lite | ERROR    | ERROR          | ERROR           | ERROR            |


