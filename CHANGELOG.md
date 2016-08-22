# CHANGELOG

### 0.9.2 - 2016-08-22

> remove unused methods. (task and resource)      

> add create, update, path, remove, get and fetch wrappers. (instead of using specific methods for each endpoint)      

> remove ES6 syntax. theeye-agent client unsupported     

### 0.8.5 - 2016-08-19

> remove taskcreate method    

> add create method, with generic payload and success failure response      


### 0.8.4 - 2016-08-17

> added reference to example in README.md     

> change task create payload : `task_id` become `task`.     

> added `script_runas` parameter      

> remove `throw new Error` when credentials are invalid or not present. instead create and return an Error instance      


### 0.8.3 - 2016-08-03

> change license to MIT

> method interface. change method response

### 0.8.2 - 2016-07-29

> add validation on getNextPendingJob method

### 0.8.1 - 2016-07-25

> added this changelog.    

> scriptDownloadStream method , return the stream to complete the download outside the client.    

> README.md updated with sample code to use this client.    

> added example directory with sample code.    
