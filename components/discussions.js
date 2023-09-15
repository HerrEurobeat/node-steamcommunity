const Cheerio = require('cheerio');

const SteamCommunity = require('../index.js');
const Helpers = require('../components/helpers.js');


/**
 * Scrapes a range of comments from a Steam discussion
 * @param {url} url - SteamCommunity url pointing to the discussion to fetch
 * @param {number} startIndex - Index (0 based) of the first comment to fetch
 * @param {number} endIndex - Index (0 based) of the last comment to fetch
 * @param {function} callback - Takes only an Error object/null as the first argument
 */
SteamCommunity.prototype.getDiscussionComments = function(url, startIndex, endIndex, callback) {
	this.httpRequestGet(url + "?l=en", async (err, res, body) => {

		if (err) {
			callback("Failed to load discussion: " + err, null);
			return;
		}


		// Load output into cheerio to make parsing easier
		let $ = Cheerio.load(body);

		let paging = $(".forum_paging > .forum_paging_summary").children();

		/**
		 * Stores every loaded page inside a Cheerio instance
		 * @type {{[key: number]: cheerio.Root}}
		 */
		let pages = { 
			0: $
		};


		// Determine amount of comments per page and total. Update endIndex if null to get all comments
		let commentsPerPage = Number(paging[4].children[0].data);
		let totalComments   = Number(paging[5].children[0].data)

		if (endIndex == null || endIndex > totalComments - 1) { // Make sure to check against null as the index 0 would cast to false
			endIndex = totalComments - 1;
		}


		// Save all pages that need to be fetched in order to get the requested comments
		let firstPage = Math.trunc(startIndex / commentsPerPage); // Index of the first page that needs to be fetched
		let lastPage  = Math.trunc(endIndex   / commentsPerPage);
		let promises  = [];

		for (let i = firstPage; i <= lastPage; i++) {
			if (i == 0) continue; // First page is already in pages object

			promises.push(new Promise((resolve) => {
				setTimeout(() => { // Delay fetching a bit to reduce the risk of Steam blocking us

					this.httpRequestGet(url + "?l=en&ctp=" + (i + 1), (err, res, body) => {
						try {
							pages[i] = Cheerio.load(body);
							resolve();
						} catch (err) {
							return callback("Failed to load comments page: " + err, null);
						}
					}, "steamcommunity");

				}, 250 * i);
			}));
		}

		await Promise.all(promises); // Wait for all pages to be fetched


		// Fill comments with content of all comments
		let comments = [];

		for (let i = startIndex; i <= endIndex; i++) {
			let $ = pages[Math.trunc(i / commentsPerPage)];

			let thisComment = $(`.forum_comment_permlink:contains("#${i + 1}")`).parent();

			// Note: '>' inside the cheerio selectors didn't work here
			let authorContainer = thisComment.children(".commentthread_comment_content").children(".commentthread_comment_author").children(".commentthread_author_link");
			let commentContainer = thisComment.children(".commentthread_comment_content").children(".commentthread_comment_text");


			// Prepare comment text
			let commentText = "";

			if (commentContainer.children(".bb_blockquote").length != 0) { // Check if comment contains quote
				commentText += commentContainer.children(".bb_blockquote").children(".bb_quoteauthor").text() + "\n"; // Get quote header and add a proper newline

				let quoteWithNewlines = commentContainer.children(".bb_blockquote").first().find("br").replaceWith("\n"); // Replace <br>'s with newlines to get a proper output

				commentText += quoteWithNewlines.end().contents().filter(function() { return this.type === 'text' }).text().trim(); // Get blockquote content without child content - https://stackoverflow.com/a/23956052

				commentText += "\n\n-------\n\n"; // Add spacer
			}

			let quoteWithNewlines = commentContainer.first().find("br").replaceWith("\n"); // Replace <br>'s with newlines to get a proper output

			commentText += quoteWithNewlines.end().contents().filter(function() { return this.type === 'text' }).text().trim(); // Add comment content without child content - https://stackoverflow.com/a/23956052


			comments.push({
				index: i,
				commentId: thisComment.attr("id").replace("comment_", ""),
				commentLink: `${url}#${thisComment.attr("id").replace("comment_", "c")}`,
				authorLink: authorContainer.attr("href"),                                 // I did not call 'resolveVanityURL()' here and convert to SteamID to reduce the amount of potentially unused Steam pings
				postedDate: Helpers.decodeSteamTime(authorContainer.children(".commentthread_comment_timestamp").text().trim()),
				content: commentText.trim()
			});
		}

		
		// Callback our result
		callback(null, comments);

    }, "steamcommunity");
};