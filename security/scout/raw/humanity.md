

<style>
.markdown-body table {min-width: 100%;width: 100%;display: table;}
thead {min-width: 100%;width: 100%;}
th {min-width: 60%;width: 60%;}
th:last-child {min-width: 20%;width: 20%;}
th:first-child {min-width: 20%;width: 20%;}
</style>



# Scout Report - Contracts - 2026-11-16

## Summary

| <span style="color:green">Crate</span> | <span style="color:green">Status</span> | <span style="color:green">Critical</span> | <span style="color:green">Medium</span> | <span style="color:green">Minor</span> | <span style="color:green">Enhancement</span> | 
| - | - | - | - | - | - | 
| humanity | Analyzed | 3 | 4 | 1 | 7 | 


Issues found:



- [Dos Unexpected Revert With Storage](#dos-unexpected-revert-with-storage) (1 results) (Medium)

- [Integer Overflow Or Underflow](#integer-overflow-or-underflow) (3 results) (Critical)

- [Missing New Admin Auth](#missing-new-admin-auth) (1 results) (Medium)

- [Unsafe Expect](#unsafe-expect) (3 results) (Medium)

- [Storage Change Events](#storage-change-events) (7 results) (Enhancement)



## DoS



### Dos Unexpected Revert With Storage

**Impact:** Medium

**Issue:** This storage (vector or map) operation is called without access control

**Description:**  It occurs by preventing transactions by other users from being successfully executed forcing the blockchain state to revert to its original state.

[**Learn More**](https://coinfabrik.github.io/scout-audit/docs/detectors/soroban/dos-unexpected-revert-with-storage)

#### Findings

| ID  | Package | File Location |
| --- | ------- | ------------- |
| 2 | humanity | [groth16.rs:99:17 - 99:26](humanity/src/groth16.rs) |



## Arithmetic



### Integer Overflow Or Underflow

**Impact:** Critical

**Issue:** Potential for integer arithmetic overflow/underflow. Consider checked, wrapping or saturating arithmetic.

**Description:** An overflow/underflow is typically caught and generates an error. When it is not caught, the operation will result in an inexact result which could lead to serious problems.

[**Learn More**](https://coinfabrik.github.io/scout-audit/docs/detectors/soroban/integer-overflow-or-underflow)

#### Findings

| ID  | Package | File Location |
| --- | ------- | ------------- |
| 0 | humanity | [groth16.rs:60:9 - 60:15](humanity/src/groth16.rs) |
| 1 | humanity | [groth16.rs:61:21 - 61:42](humanity/src/groth16.rs) |
| 3 | humanity | [groth16.rs:98:57 - 98:62](humanity/src/groth16.rs) |



## Authorization



### Missing New Admin Auth

**Impact:** Medium

**Issue:** New admin/owner address must sign before being stored

**Description:** When updating admin or owner, the incoming address should also sign to prevent accidental bricking due to a mistaken address.

[**Learn More**](https://coinfabrik.github.io/scout-audit/docs/detectors/soroban/missing-new-admin-auth)

#### Findings

| ID  | Package | File Location |
| --- | ------- | ------------- |
| 7 | humanity | [lib.rs:179:9 - 179:73](humanity/src/lib.rs) |



## Error Handling



### Unsafe Expect

**Impact:** Medium

**Issue:** Unsafe usage of `expect`

**Description:** In Rust, the expect method is commonly used for error handling. It retrieves the value from a Result or Option and panics with a specified error message if an error occurs. However, using expect can lead to unexpected program crashes.    

[**Learn More**](https://coinfabrik.github.io/scout-audit/docs/detectors/rust/unsafe-expect)

#### Findings

| ID  | Package | File Location |
| --- | ------- | ------------- |
| 4 | humanity | [lib.rs:222:32 - 226:39](humanity/src/lib.rs) |
| 6 | humanity | [lib.rs:297:43 - 300:40](humanity/src/lib.rs) |


### Unused Return Enum

**Impact:** Minor

**Issue:** If any of the variants (Ok/Err) is not used, the code could be simplified or it could imply a bug

**Description:** Soroban functions can return a Result enum with a custom error type. This is useful for the caller to know what went wrong when the message fails. The definition of the Result type enum consists of two variants: Ok and Err. If any of the variants is not used, the code could be simplified or it could imply a bug.    

[**Learn More**](https://coinfabrik.github.io/scout-audit/docs/detectors/soroban/unused-return-enum)

#### Findings

| ID  | Package | File Location |
| --- | ------- | ------------- |
| 5 | humanity | [lib.rs:247:9 - 247:15](humanity/src/lib.rs) |



## Best Practices



### Storage Change Events

**Impact:** Enhancement

**Issue:** Consider emiting an event when storage is modified

**Description:** Emiting an event when storage changes is a good practice to make the contracts more transparent and usable to its clients and observers

[**Learn More**](https://coinfabrik.github.io/scout-audit/docs/detectors/soroban/storage-change-events)

#### Findings

| ID  | Package | File Location |
| --- | ------- | ------------- |
| 8 | humanity | [lib.rs:241:5 - 241:84](humanity/src/lib.rs) |
| 9 | humanity | [lib.rs:261:5 - 272:27](humanity/src/lib.rs) |
| 10 | humanity | [lib.rs:216:5 - 221:27](humanity/src/lib.rs) |
| 11 | humanity | [lib.rs:183:5 - 183:55](humanity/src/lib.rs) |
| 12 | humanity | [lib.rs:200:5 - 200:51](humanity/src/lib.rs) |
| 13 | humanity | [lib.rs:208:5 - 208:63](humanity/src/lib.rs) |
| 14 | humanity | [lib.rs:177:5 - 177:55](humanity/src/lib.rs) |


