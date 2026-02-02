document.addEventListener('DOMContentLoaded', async function() {
	// once the DOM is loaded, attach an onclick handler to the button
	document.getElementById("click-me-button").addEventListener("click", handleClickMe);
});


async function handleClickMe() {
	// create a new paragraph tag: <p></p>
	const p = document.createElement("p");

	// Send a GET /api request to the server
	const res = await fetch("/api", { method: "GET" });
	if (res.ok) {
		// set the text of the paragraph to the server response if successful
		// <p>API is running!</p>
		p.textContent = await res.text();
	} else {
		// other, set the paragraph text to be the error message
		p.textContent = res.statusText;
	}
	// insert the paragraph after the <button></button> tag
	document.body.appendChild(p);
}
